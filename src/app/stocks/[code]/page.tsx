import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  syncListedInfoIfStale,
  syncPricesIfStale,
  syncFinancialsIfStale,
} from "@/lib/sync";
import { JQuantsAuthError, JQuantsApiError } from "@/lib/jquants";
import {
  deriveMetrics,
  formatYen,
  formatPercent,
  formatNumber,
  type FiscalYearSummary,
} from "@/lib/financial-metrics";
import { CandleChart, type CandlePoint } from "@/components/candle-chart";
import { WatchToggle } from "@/components/watch-toggle";
import { fetchYahoo, fetchYahooDividends } from "@/lib/yahoo-finance";
import { summarizeDividends } from "@/lib/dividend-summary";
import { DividendSection } from "@/components/dividend-section";
import { FYTrendChart, type FYTrendBar } from "@/components/fy-trend-chart";
import { AiAnalyze } from "@/components/ai-analyze";
import { AutoDiagnose } from "@/components/auto-diagnose";
import { InvestmentScoreCard } from "@/components/investment-score-card";
import {
  PeerComparisonTable,
  type ComparisonRow,
} from "@/components/peer-comparison-table";
import { isAiEnabled } from "@/lib/ai";

type PageProps = {
  params: Promise<{ code: string }>;
};

export default async function StockDetail({ params }: PageProps) {
  const { code } = await params;

  // Make sure listed info is loaded
  try {
    await syncListedInfoIfStale();
  } catch (e) {
    return <ApiErrorView error={e} />;
  }

  const stock = await prisma.listedStock.findUnique({ where: { code } });
  if (!stock) notFound();

  // Update browse history (fire-and-forget)
  prisma.browseHistory
    .upsert({
      where: { code },
      create: { code },
      update: { lastViewed: new Date() },
    })
    .catch(() => null);

  // PRIMARY SOURCE: Yahoo Finance (real-time + 5y history, no auth, no rate limit)
  // FALLBACK: existing J-Quants PriceCache (12-week delayed, bounded by API quota)
  const [yahoo, dividends] = await Promise.all([
    fetchYahoo(code, "5y", 60),
    fetchYahooDividends(code, 3, 3600),
  ]);

  // Background-refresh J-Quants cache as a fallback in case Yahoo goes down
  syncPricesIfStale(code).catch(() => null);

  // Map Yahoo bars to PriceCache shape; if Yahoo unavailable, read DB cache
  type PriceRow = {
    date: Date;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  };
  let prices: PriceRow[];
  if (yahoo && yahoo.bars.length > 0) {
    prices = yahoo.bars.map((b) => ({
      date: new Date(b.time),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }));
  } else {
    prices = await prisma.priceCache.findMany({
      where: { code },
      orderBy: { date: "asc" },
    });
  }

  // Read financial data + forecast from cache. Background-refresh without blocking render.
  const [financialRows, forecast] = await Promise.all([
    prisma.financialCache.findMany({
      where: { code },
      orderBy: { fiscalYearEnd: "asc" },
    }),
    prisma.forecast.findUnique({ where: { code } }),
  ]);
  syncFinancialsIfStale(code).catch(() => null);

  const annualSummaries: FiscalYearSummary[] = financialRows.map((f) => ({
    fiscalYearEnd: f.fiscalYearEnd,
    netSales: f.netSales,
    operatingProfit: f.operatingProfit,
    ordinaryProfit: f.ordinaryProfit,
    netIncome: f.netIncome,
    eps: f.eps,
    totalAssets: f.totalAssets,
    equity: f.equity,
    equityRatio: f.equityRatio,
    bookValuePerShare: f.bookValuePerShare,
    dividend: f.dividend,
  }));

  const candleData: CandlePoint[] = prices.map((p) => ({
    time: p.date.toISOString().slice(0, 10),
    open: p.open,
    high: p.high,
    low: p.low,
    close: p.close,
    volume: p.volume,
  }));

  // Use Yahoo's truly-live price if we have it (may be intraday, ahead of last bar);
  // otherwise fall back to the latest cached close.
  const latestPrice =
    yahoo?.regularMarketPrice ??
    (prices.length > 0 ? prices[prices.length - 1].close : null);
  const latestDate =
    yahoo?.regularMarketTime != null
      ? new Date(yahoo.regularMarketTime * 1000)
      : prices.length > 0
        ? prices[prices.length - 1].date
        : null;
  const isLive = yahoo?.regularMarketPrice != null;
  const metrics = deriveMetrics(annualSummaries, latestPrice);

  const isWatched = (await prisma.watchlist.findUnique({ where: { code } })) != null;

  // Same-sector peers (up to 8). Prefer the same scale category to avoid
  // mixing megacaps with micro-caps; fall back to other scales as needed.
  const peers = stock.sector33Code
    ? await (async () => {
        const wantedSize = 8;
        const sameScale = stock.scaleCategory
          ? await prisma.listedStock.findMany({
              where: {
                sector33Code: stock.sector33Code,
                scaleCategory: stock.scaleCategory,
                code: { not: code },
              },
              take: wantedSize,
              orderBy: { ticker: "asc" },
            })
          : [];
        if (sameScale.length >= wantedSize) return sameScale;
        const fillerNeeded = wantedSize - sameScale.length;
        const filler = await prisma.listedStock.findMany({
          where: {
            sector33Code: stock.sector33Code,
            scaleCategory: { not: null },
            code: { notIn: [code, ...sameScale.map((s) => s.code)] },
          },
          take: fillerNeeded,
          orderBy: { ticker: "asc" },
        });
        return [...sameScale, ...filler];
      })()
    : [];

  // Background-sync up to 2 peers without cached data (rate-limit-friendly).
  // Each visit gradually fills in peer data; full coverage emerges after ~5 visits.
  void (async () => {
    let started = 0;
    for (const p of peers) {
      if (started >= 2) break;
      const hasFin = await prisma.financialCache.count({ where: { code: p.code } });
      if (hasFin > 0) continue;
      // Don't await — let these run in the background; helpers retry on 429
      syncPricesIfStale(p.code).catch(() => null);
      syncFinancialsIfStale(p.code).catch(() => null);
      started++;
    }
  })();

  const peerMetrics = await Promise.all(
    peers.map(async (p) => {
      const [yahooPeer, latestPriceRow, latestFin, peerForecast] = await Promise.all([
        // Use a longer cache (5 min) for peer prices to avoid 8 simultaneous fetches every time
        fetchYahoo(p.code, "1mo", 300).catch(() => null),
        prisma.priceCache.findFirst({
          where: { code: p.code },
          orderBy: { date: "desc" },
        }),
        prisma.financialCache.findFirst({
          where: { code: p.code },
          orderBy: { fiscalYearEnd: "desc" },
        }),
        prisma.forecast.findUnique({ where: { code: p.code } }),
      ]);
      // Live (Yahoo) > cached J-Quants
      const price =
        yahooPeer?.regularMarketPrice ?? latestPriceRow?.close ?? null;
      const eps = latestFin?.eps ?? null;
      const bps = latestFin?.bookValuePerShare ?? null;
      const per = price != null && eps != null && eps !== 0 ? price / eps : null;
      const pbr = price != null && bps != null && bps !== 0 ? price / bps : null;
      const roe =
        latestFin?.netIncome != null && latestFin?.equity != null && latestFin.equity !== 0
          ? (latestFin.netIncome / latestFin.equity) * 100
          : null;
      const equityRatio =
        latestFin?.equityRatio != null ? latestFin.equityRatio * 100 : null;
      return {
        code: p.code,
        ticker: p.ticker,
        name: p.name,
        isSelf: false,
        hasData: latestFin != null || latestPriceRow != null,
        latestPrice: price,
        per,
        pbr,
        roe,
        salesYoY: latestFin?.salesYoY ?? null,
        profitYoY: latestFin?.profitYoY ?? null,
        equityRatio,
        forecastSalesYoY: peerForecast?.salesYoYImplied ?? null,
        forecastProfitYoY: peerForecast?.profitYoYImplied ?? null,
        dividendYield:
          latestFin?.dividend != null && price != null && price !== 0
            ? (latestFin.dividend / price) * 100
            : null,
      } satisfies ComparisonRow;
    }),
  );

  // Compute change vs previous close. Prefer Yahoo's previousClose (always
  // correct relative to live price); fall back to second-to-last bar.
  const prevClose =
    yahoo?.previousClose ??
    (prices.length >= 2 ? prices[prices.length - 2].close : null);
  const change =
    latestPrice != null && prevClose != null ? latestPrice - prevClose : null;
  const changePct =
    change != null && prevClose != null && prevClose !== 0
      ? (change / prevClose) * 100
      : null;

  // 52-week high/low — prefer Yahoo's official 52w (rolling), fall back to bar-derived
  const year52High =
    yahoo?.fiftyTwoWeekHigh ??
    (prices.length > 0 ? Math.max(...prices.map((p) => p.high)) : null);
  const year52Low =
    yahoo?.fiftyTwoWeekLow ??
    (prices.length > 0 ? Math.min(...prices.map((p) => p.low)) : null);
  const positionInRange =
    latestPrice != null && year52High != null && year52Low != null && year52High !== year52Low
      ? ((latestPrice - year52Low) / (year52High - year52Low)) * 100
      : null;

  // Returns over various windows
  function returnPct(daysBack: number): number | null {
    if (latestPrice == null || prices.length === 0) return null;
    const idx = prices.length - 1 - daysBack;
    if (idx < 0) return null;
    const past = prices[idx].close;
    if (past === 0) return null;
    return ((latestPrice - past) / past) * 100;
  }
  const ret1M = returnPct(20);
  const ret3M = returnPct(60);
  const ret6M = returnPct(120);
  const ret1Y = returnPct(240);

  // Volume spike: today's volume vs 20-day average
  const todayVolume = yahoo?.regularMarketVolume ?? null;
  const avgVolume20 =
    prices.length >= 20
      ? prices
          .slice(prices.length - 20)
          .reduce((s, p) => s + p.volume, 0) / 20
      : null;
  const volumeRatio =
    todayVolume != null && avgVolume20 != null && avgVolume20 > 0
      ? todayVolume / avgVolume20
      : null;
  const volumeSpike = volumeRatio != null && volumeRatio >= 2;

  // Build comparison rows: self first, peers sorted by salesYoY desc (data-less last)
  const latestFinSelf = financialRows[financialRows.length - 1] ?? null;
  const equityRatioSelf =
    latestFinSelf?.equityRatio != null ? latestFinSelf.equityRatio * 100 : null;
  // Trailing dividend yield (Yahoo dividend history is more accurate than
  // statement's annual dividend for current yield).
  const trailingAnnualDiv = (() => {
    if (dividends.length === 0) return null;
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const cutoff = oneYearAgo.toISOString().slice(0, 10);
    const recent = dividends.filter((d) => d.date >= cutoff);
    if (recent.length === 0) return null;
    return recent.reduce((s, d) => s + d.amount, 0);
  })();
  const selfYield =
    trailingAnnualDiv != null && latestPrice != null && latestPrice !== 0
      ? (trailingAnnualDiv / latestPrice) * 100
      : null;

  const selfRow: ComparisonRow = {
    code,
    ticker: stock.ticker,
    name: stock.name,
    isSelf: true,
    hasData: latestFinSelf != null || latestPrice != null,
    latestPrice,
    per: metrics.per,
    pbr: metrics.pbr,
    roe: metrics.roe,
    salesYoY: metrics.salesGrowthYoY,
    profitYoY: metrics.profitGrowthYoY,
    equityRatio: equityRatioSelf,
    forecastSalesYoY: forecast?.salesYoYImplied ?? null,
    forecastProfitYoY: forecast?.profitYoYImplied ?? null,
    dividendYield: selfYield,
  };
  const sortedPeers = [...peerMetrics].sort((a, b) => {
    const av = a.salesYoY ?? Number.NEGATIVE_INFINITY;
    const bv = b.salesYoY ?? Number.NEGATIVE_INFINITY;
    return bv - av;
  });
  const comparisonRows: ComparisonRow[] = [selfRow, ...sortedPeers];

  // Discovery: small-cap stocks with HIGHER sales YoY than current stock (or >0)
  const ownYoY = metrics.salesGrowthYoY ?? 0;
  const discoveryRaw = await prisma.financialCache.findMany({
    where: {
      salesYoY: { gt: ownYoY },
      code: { not: code },
      stock: {
        scaleCategory: { in: ["TOPIX Small 1", "TOPIX Small 2"] },
      },
    },
    orderBy: { salesYoY: "desc" },
    take: 5,
    include: { stock: true },
  });
  const discoveryWithForecasts = await Promise.all(
    discoveryRaw.map(async (d) => {
      const fc = await prisma.forecast.findUnique({ where: { code: d.code } });
      return { ...d, forecast: fc };
    }),
  );

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight">{stock.name}</h1>
            <span className="font-mono text-neutral-500 text-lg">{stock.ticker}</span>
            {stock.scaleCategory && (
              <span className="text-xs px-2 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300">
                {stock.scaleCategory}
              </span>
            )}
          </div>
          <div className="text-sm text-neutral-500 mt-1 flex gap-2 flex-wrap">
            {stock.sector33Name && <span>{stock.sector33Name}</span>}
            {stock.marketName && <span>・{stock.marketName}</span>}
            {stock.sector17Name && <span>・{stock.sector17Name}</span>}
          </div>
        </div>
        <WatchToggle code={code} initialWatched={isWatched} />
      </header>

      <section className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-5">
        <div className="flex items-baseline gap-4 flex-wrap">
          <div>
            <div className="flex items-baseline gap-2 flex-wrap">
              {isLive && (
                <span className="inline-flex items-center gap-1 text-[10px] text-red-500 font-bold">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  LIVE
                </span>
              )}
              {volumeSpike && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] text-orange-600 dark:text-orange-400 font-bold rounded-full bg-orange-50 dark:bg-orange-950/40 px-2 py-0.5 border border-orange-200 dark:border-orange-900/40"
                  title={`平均20日比の出来高: ${volumeRatio?.toFixed(1)}倍`}
                >
                  🔥 出来高急増 ({volumeRatio?.toFixed(1)}x)
                </span>
              )}
              <div className="text-3xl font-bold tabular-nums">
                {latestPrice != null ? `${latestPrice.toLocaleString("ja-JP")}円` : "—"}
              </div>
            </div>
            {change != null && changePct != null && (
              <div
                className={`text-sm tabular-nums mt-1 ${
                  change >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                前日比 {change >= 0 ? "+" : ""}
                {change.toFixed(1)}円（{change >= 0 ? "+" : ""}
                {changePct.toFixed(2)}%）
              </div>
            )}
          </div>
          {yahoo &&
            yahoo.regularMarketDayHigh != null &&
            yahoo.regularMarketDayLow != null && (
              <div className="text-xs text-neutral-500 ml-auto space-y-0.5">
                <div>
                  当日高 <span className="text-emerald-600 dark:text-emerald-400 tabular-nums font-medium">
                    {yahoo.regularMarketDayHigh.toLocaleString("ja-JP")}
                  </span>{" "}
                  / 安 <span className="text-red-600 dark:text-red-400 tabular-nums font-medium">
                    {yahoo.regularMarketDayLow.toLocaleString("ja-JP")}
                  </span>
                </div>
                {latestDate && (
                  <div className="text-neutral-400">
                    取得時刻: {latestDate.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                  </div>
                )}
                <div className="text-neutral-400">Yahoo Finance（〜数分遅延）</div>
              </div>
            )}
          {!yahoo && latestDate && (
            <div className="text-xs text-neutral-500 ml-auto">
              データ日付: {latestDate.toLocaleDateString("ja-JP")}（J-Quants無料: 約12週遅延）
            </div>
          )}
        </div>

        {(ret1M != null || ret3M != null || ret6M != null || ret1Y != null) && (
          <div className="mt-4 pt-4 border-t border-black/5 dark:border-white/5 grid grid-cols-4 gap-3 text-xs">
            <ReturnCell label="1ヶ月" value={ret1M} />
            <ReturnCell label="3ヶ月" value={ret3M} />
            <ReturnCell label="6ヶ月" value={ret6M} />
            <ReturnCell label="1年" value={ret1Y} />
          </div>
        )}

        {year52High != null && year52Low != null && (
          <div className="mt-4 pt-4 border-t border-black/5 dark:border-white/5 grid grid-cols-3 gap-3 text-xs">
            <div>
              <div className="text-neutral-500">取得期間 高値</div>
              <div className="font-semibold tabular-nums mt-0.5 text-emerald-600 dark:text-emerald-400">
                {year52High.toLocaleString("ja-JP")}円
              </div>
            </div>
            <div>
              <div className="text-neutral-500">取得期間 安値</div>
              <div className="font-semibold tabular-nums mt-0.5 text-red-600 dark:text-red-400">
                {year52Low.toLocaleString("ja-JP")}円
              </div>
            </div>
            <div>
              <div className="text-neutral-500">レンジ内位置</div>
              <div className="font-semibold tabular-nums mt-0.5">
                {positionInRange != null ? `${positionInRange.toFixed(0)}%` : "—"}
              </div>
              {positionInRange != null && (
                <div className="mt-1 h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-red-500 via-amber-500 to-emerald-500"
                    style={{ width: `${positionInRange}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-3">
        <div className="px-2 pb-2 text-sm font-medium text-neutral-600 dark:text-neutral-400">
          ローソク足チャート（日足） / 出来高
        </div>
        {candleData.length === 0 ? (
          <div className="h-[460px] flex flex-col items-center justify-center gap-2 text-sm text-neutral-500 border border-dashed rounded-xl">
            <div className="text-amber-600 dark:text-amber-400">
              ⏳ 株価データを取得できませんでした
            </div>
            <div className="text-xs">
              J-Quants 無料プランのレート制限の可能性があります。数分後にページを再読込してください。
            </div>
          </div>
        ) : (
          <CandleChart data={candleData} />
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <InvestmentScoreCard
          input={{
            salesYoY: metrics.salesGrowthYoY,
            roe: metrics.roe,
            per: metrics.per,
            equityRatio: equityRatioSelf,
            forecastSalesYoY: forecast?.salesYoYImplied ?? null,
          }}
        />
        <AutoDiagnose
          input={{
            scaleCategory: stock.scaleCategory,
            per: metrics.per,
            pbr: metrics.pbr,
            roe: metrics.roe,
            salesYoY: metrics.salesGrowthYoY,
            profitYoY: metrics.profitGrowthYoY,
            forecastSalesYoY: forecast?.salesYoYImplied ?? null,
            forecastProfitYoY: forecast?.profitYoYImplied ?? null,
            equityRatio: equityRatioSelf,
            ret1M,
            ret3M,
            ret1Y,
            rangePosition: positionInRange,
          }}
        />
      </div>

      <AiAnalyze code={code} aiEnabled={isAiEnabled()} />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="PER（株価収益率）" value={formatNumber(metrics.per)} suffix="倍" />
        <MetricCard label="PBR（株価純資産倍率）" value={formatNumber(metrics.pbr)} suffix="倍" />
        <MetricCard
          label="ROE（自己資本利益率）"
          value={formatPercent(metrics.roe)}
        />
        <MetricCard
          label="売上成長率（YoY）"
          value={formatPercent(metrics.salesGrowthYoY)}
          highlight={
            metrics.salesGrowthYoY != null && metrics.salesGrowthYoY > 0
              ? "good"
              : metrics.salesGrowthYoY != null && metrics.salesGrowthYoY < 0
                ? "bad"
                : null
          }
        />
      </section>

      {peers.length > 0 && (
        <PeerComparisonTable
          rows={comparisonRows}
          sectorName={stock.sector33Name}
          peerCodes={peers.map((p) => p.code)}
        />
      )}

      <DividendSection summary={summarizeDividends(dividends, latestPrice)} />

      {discoveryWithForecasts.length > 0 && (
        <section className="rounded-2xl border border-emerald-200 dark:border-emerald-900/50 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/30 dark:to-neutral-900 p-5">
          <div className="flex items-baseline justify-between gap-2 flex-wrap mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <span className="text-emerald-600 dark:text-emerald-400">🌱</span>
              この銘柄より成長率が高い小型株（発掘候補）
            </h2>
            <span className="text-xs text-neutral-500">
              現在の売上YoY {ownYoY > 0 ? "+" : ""}
              {ownYoY.toFixed(1)}% 超
            </span>
          </div>
          <ul className="space-y-1">
            {discoveryWithForecasts.map((d) => (
              <li key={d.code}>
                <a
                  href={`/stocks/${d.code}`}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-white/60 dark:hover:bg-neutral-900/40 transition text-sm"
                >
                  <span className="min-w-0 flex items-center gap-2 flex-1">
                    <span className="font-mono text-neutral-500 shrink-0">
                      {d.stock.ticker}
                    </span>
                    <span className="truncate font-medium">{d.stock.name}</span>
                    <span className="text-xs text-neutral-500 shrink-0 hidden sm:inline">
                      {d.stock.sector33Name}
                    </span>
                  </span>
                  <span className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-neutral-500 hidden md:inline tabular-nums">
                      予想{d.forecast?.salesYoYImplied != null
                        ? `${d.forecast.salesYoYImplied > 0 ? "+" : ""}${d.forecast.salesYoYImplied.toFixed(1)}%`
                        : "—"}
                    </span>
                    {d.salesYoY != null && (
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold tabular-nums">
                        +{d.salesYoY.toFixed(1)}%
                      </span>
                    )}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {forecast && (
        <section className="rounded-2xl border border-sky-200 dark:border-sky-900/50 bg-gradient-to-br from-sky-50 to-white dark:from-sky-950/30 dark:to-neutral-900 p-5">
          <div className="flex items-baseline justify-between gap-2 flex-wrap mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <span className="text-sky-600 dark:text-sky-400">📈</span>
              会社予想（{forecast.forFiscalYearEnd} 期）
            </h2>
            <span className="text-xs text-neutral-500">
              開示日: {forecast.disclosedDate}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ForecastCell label="予想売上" value={forecast.netSales} kind="yen-compact" />
            <ForecastCell label="予想営業利益" value={forecast.operatingProfit} kind="yen-compact" />
            <ForecastCell label="予想純利益" value={forecast.netIncome} kind="yen-compact" />
            <ForecastCell label="予想EPS" value={forecast.eps} kind="yen-per-share" />
          </div>
          {(forecast.salesYoYImplied != null || forecast.profitYoYImplied != null) && (
            <div className="mt-4 pt-4 border-t border-sky-200/60 dark:border-sky-900/30 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-neutral-500">予想売上YoY (vs 直近通期)</div>
                <div
                  className={`text-lg font-bold tabular-nums mt-0.5 ${
                    (forecast.salesYoYImplied ?? 0) > 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : (forecast.salesYoYImplied ?? 0) < 0
                        ? "text-red-600 dark:text-red-400"
                        : ""
                  }`}
                >
                  {forecast.salesYoYImplied != null
                    ? `${forecast.salesYoYImplied > 0 ? "+" : ""}${forecast.salesYoYImplied.toFixed(2)}%`
                    : "—"}
                </div>
              </div>
              <div>
                <div className="text-xs text-neutral-500">予想純利益YoY (vs 直近通期)</div>
                <div
                  className={`text-lg font-bold tabular-nums mt-0.5 ${
                    (forecast.profitYoYImplied ?? 0) > 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : (forecast.profitYoYImplied ?? 0) < 0
                        ? "text-red-600 dark:text-red-400"
                        : ""
                  }`}
                >
                  {forecast.profitYoYImplied != null
                    ? `${forecast.profitYoYImplied > 0 ? "+" : ""}${forecast.profitYoYImplied.toFixed(2)}%`
                    : "—"}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {annualSummaries.length > 0 && (() => {
        const recent: FYTrendBar[] = annualSummaries.slice(-5).map((s) => ({
          fiscalYearEnd: s.fiscalYearEnd,
          netSales: s.netSales,
          netIncome: s.netIncome,
          isForecast: false,
        }));
        if (forecast) {
          recent.push({
            fiscalYearEnd: forecast.forFiscalYearEnd,
            netSales: forecast.netSales,
            netIncome: forecast.netIncome,
            isForecast: true,
          });
        }
        return (
          <section className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-5 space-y-5">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              業績推移
              {forecast && (
                <span className="text-[10px] text-sky-700 dark:text-sky-400 font-normal">
                  （ハッチ部分は会社予想）
                </span>
              )}
            </h2>
            <div className="grid gap-6 sm:grid-cols-2">
              <FYTrendChart bars={recent} metric="netSales" label="売上高" />
              <FYTrendChart bars={recent} metric="netIncome" label="純利益" />
            </div>
          </section>
        );
      })()}

      {annualSummaries.length > 0 && (
        <section className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-5">
          <h2 className="text-sm font-semibold mb-3">業績推移（通期テーブル）</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-neutral-500">
                <tr>
                  <th className="text-left px-2 py-2 font-medium">期末</th>
                  <th className="text-right px-2 py-2 font-medium">売上高</th>
                  <th className="text-right px-2 py-2 font-medium">営業利益</th>
                  <th className="text-right px-2 py-2 font-medium">純利益</th>
                  <th className="text-right px-2 py-2 font-medium">EPS</th>
                  <th className="text-right px-2 py-2 font-medium">自己資本比率</th>
                  <th className="text-right px-2 py-2 font-medium">配当</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5 dark:divide-white/5">
                {annualSummaries
                  .slice(-6)
                  .reverse()
                  .map((s) => (
                    <tr key={s.fiscalYearEnd}>
                      <td className="px-2 py-2 tabular-nums whitespace-nowrap">
                        {s.fiscalYearEnd}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {formatYen(s.netSales, { compact: true })}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {formatYen(s.operatingProfit, { compact: true })}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums font-medium">
                        {formatYen(s.netIncome, { compact: true })}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {s.eps != null ? `${s.eps.toFixed(1)}円` : "—"}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {s.equityRatio != null
                          ? `${(s.equityRatio * 100).toFixed(1)}%`
                          : "—"}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {s.dividend != null ? `${s.dividend.toFixed(1)}円` : "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {annualSummaries.length === 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-400">
          財務データはまだ取得されていません。バックグラウンドで取得を試みています。数分後にページを再読込してください。
        </div>
      )}

    </div>
  );
}

function ForecastCell({
  label,
  value,
  kind,
}: {
  label: string;
  value: number | null;
  kind: "yen-compact" | "yen-per-share";
}) {
  let text = "—";
  if (value != null) {
    if (kind === "yen-compact") {
      text = formatYen(value, { compact: true });
    } else {
      text = `${value.toFixed(2)}円`;
    }
  }
  return (
    <div className="rounded-lg bg-white/60 dark:bg-neutral-900/40 border border-sky-100 dark:border-sky-900/30 px-3 py-2">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-lg font-bold tabular-nums mt-0.5">{text}</div>
    </div>
  );
}

function ReturnCell({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div className="text-neutral-500">{label}リターン</div>
      <div
        className={`font-semibold tabular-nums mt-0.5 ${
          value == null
            ? "text-neutral-500"
            : value >= 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400"
        }`}
      >
        {value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  suffix,
  highlight,
}: {
  label: string;
  value: string;
  suffix?: string;
  highlight?: "good" | "bad" | null;
}) {
  const colorClass =
    highlight === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : highlight === "bad"
        ? "text-red-600 dark:text-red-400"
        : "";
  return (
    <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-4">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`text-2xl font-bold tabular-nums mt-1 ${colorClass}`}>
        {value}
        {suffix && <span className="text-sm font-normal ml-1">{suffix}</span>}
      </div>
    </div>
  );
}

function ApiErrorView({ error }: { error: unknown }) {
  if (error instanceof JQuantsAuthError) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-5 py-4 text-sm text-red-700 dark:text-red-400">
        <div className="font-semibold mb-1">J-Quants 認証エラー</div>
        <div>{error.message}</div>
        <div className="mt-3 text-xs text-red-600 dark:text-red-400">
          .env の <code className="font-mono">JQUANTS_REFRESH_TOKEN</code> に
          有効なリフレッシュトークンを設定し、開発サーバーを再起動してください。
        </div>
      </div>
    );
  }
  if (error instanceof JQuantsApiError) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-5 py-4 text-sm text-red-700 dark:text-red-400">
        <div className="font-semibold mb-1">J-Quants APIエラー（{error.status}）</div>
        <div>{error.message}</div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-5 py-4 text-sm text-red-700 dark:text-red-400">
      予期しないエラー: {error instanceof Error ? error.message : String(error)}
    </div>
  );
}
