import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  syncListedInfoIfStale,
  syncPricesIfStale,
  syncFinancialsIfStale,
} from "@/lib/sync";
import { statements as fetchStatements, JQuantsAuthError, JQuantsApiError } from "@/lib/jquants";
import {
  extractAnnualSummaries,
  deriveMetrics,
  formatYen,
  formatPercent,
  formatNumber,
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

  // Fetch in parallel: prices (cached) + statements (fresh) + financial cache update
  const [pricesResult, statementsResult] = await Promise.allSettled([
    syncPricesIfStale(code).then(() =>
      prisma.priceCache.findMany({
        where: { code },
        orderBy: { date: "asc" },
      }),
    ),
    fetchStatements(code),
  ]);

  // Update financial cache in background (don't block render)
  syncFinancialsIfStale(code).catch(() => null);

  if (pricesResult.status === "rejected") {
    return <ApiErrorView error={pricesResult.reason} />;
  }
  const prices = pricesResult.value;

  const annualSummaries =
    statementsResult.status === "fulfilled"
      ? extractAnnualSummaries(statementsResult.value)
      : [];

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

  // Compute change vs previous close
  const prevClose =
    prices.length >= 2 ? prices[prices.length - 2].close : null;
  const change =
    latestPrice != null && prevClose != null ? latestPrice - prevClose : null;
  const changePct =
    change != null && prevClose != null && prevClose !== 0
      ? (change / prevClose) * 100
      : null;

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

      {statementsResult.status === "rejected" && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-400">
          財務データの取得に失敗しました（後でお試しください）
        </div>
      )}
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
