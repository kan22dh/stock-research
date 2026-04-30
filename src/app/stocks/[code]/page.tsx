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
import { AiAnalyze } from "@/components/ai-analyze";
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

  // Fetch prices (sync if stale) - rate-limit safe per syncPricesIfStale TTL
  const pricesResult = await Promise.allSettled([
    syncPricesIfStale(code).then(() =>
      prisma.priceCache.findMany({
        where: { code },
        orderBy: { date: "asc" },
      }),
    ),
  ]).then((r) => r[0]);

  // Read financial data from cache. Background-refresh without blocking render.
  const financialRows = await prisma.financialCache.findMany({
    where: { code },
    orderBy: { fiscalYearEnd: "asc" },
  });
  syncFinancialsIfStale(code).catch(() => null);

  if (pricesResult.status === "rejected") {
    return <ApiErrorView error={pricesResult.reason} />;
  }
  const prices = pricesResult.value;

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

  const latestPrice = prices.length > 0 ? prices[prices.length - 1].close : null;
  const latestDate = prices.length > 0 ? prices[prices.length - 1].date : null;
  const metrics = deriveMetrics(annualSummaries, latestPrice);

  const isWatched = (await prisma.watchlist.findUnique({ where: { code } })) != null;

  // Same-sector peers (up to 8)
  const peers = stock.sector33Code
    ? await prisma.listedStock.findMany({
        where: {
          sector33Code: stock.sector33Code,
          code: { not: code },
          scaleCategory: { not: null },
        },
        take: 8,
        orderBy: { ticker: "asc" },
      })
    : [];

  // Compute change vs previous close
  const prevClose =
    prices.length >= 2 ? prices[prices.length - 2].close : null;
  const change =
    latestPrice != null && prevClose != null ? latestPrice - prevClose : null;
  const changePct =
    change != null && prevClose != null && prevClose !== 0
      ? (change / prevClose) * 100
      : null;

  // 52-week (period available) high/low
  const year52High = prices.length > 0 ? Math.max(...prices.map((p) => p.high)) : null;
  const year52Low = prices.length > 0 ? Math.min(...prices.map((p) => p.low)) : null;
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
            <div className="text-3xl font-bold tabular-nums">
              {latestPrice != null ? `${latestPrice.toLocaleString("ja-JP")}円` : "—"}
            </div>
            {change != null && changePct != null && (
              <div
                className={`text-sm tabular-nums mt-1 ${
                  change >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {change >= 0 ? "+" : ""}
                {change.toFixed(1)}円（{change >= 0 ? "+" : ""}
                {changePct.toFixed(2)}%）
              </div>
            )}
          </div>
          {latestDate && (
            <div className="text-xs text-neutral-500 ml-auto">
              データ日付: {latestDate.toLocaleDateString("ja-JP")}（無料プラン: 約12週遅延）
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
        <CandleChart data={candleData} />
      </section>

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

      {annualSummaries.length > 0 && (
        <section className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-5">
          <h2 className="text-sm font-semibold mb-3">業績推移（通期）</h2>
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

      {peers.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-3">同業他社（{stock.sector33Name}）</h2>
          <ul className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 divide-y divide-black/5 dark:divide-white/5 overflow-hidden">
            {peers.map((p) => (
              <li key={p.code}>
                <a
                  href={`/stocks/${p.code}`}
                  className="flex items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition"
                >
                  <span className="min-w-0 flex items-center gap-2">
                    <span className="font-mono text-neutral-500 shrink-0">{p.ticker}</span>
                    <span className="truncate font-medium">{p.name}</span>
                  </span>
                  <span className="text-xs text-neutral-500 shrink-0">
                    {p.scaleCategory}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
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
