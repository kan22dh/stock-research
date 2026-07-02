import Link from "next/link";
import { prisma } from "@/lib/db";
import { syncListedInfoIfStale } from "@/lib/sync";
import { JQuantsAuthError } from "@/lib/jquants";
import { BulkSyncButton } from "@/components/bulk-sync-button";
import { MomentumSyncButton } from "@/components/momentum-sync-button";
import { formatYen, formatPercent } from "@/lib/financial-metrics";
import { investmentScore, scoreColor } from "@/lib/investment-score";
import { computeRSRatings, rsRatingColor } from "@/lib/momentum";
import { findSectorLaggards } from "@/lib/sector-laggards";

const SMALL_SCALES = ["TOPIX Small 1", "TOPIX Small 2"];

type SearchParams = Promise<{
  growth?: string;
  profit?: string;
  fcGrowth?: string;
  minRoe?: string; // ROE >= N %
  maxPer?: string; // PER <= N
  minRS?: string; // RS Rating >= N (1-99)
  trendTemplate?: string; // "1" = require 7/7 technical + RS>=70
  vcp?: string; // "1" = require VCP setup (tight base near highs, volume dry-up)
  strategy?: string; // "laggard" = Ozaki-style sector laggard scan
  sort?: string;
}>;

export default async function ScreenerPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const minGrowth = sp.growth ? Number(sp.growth) : 0;
  const minProfit = sp.profit ? Number(sp.profit) : -9999;
  const minFcGrowth = sp.fcGrowth ? Number(sp.fcGrowth) : -9999;
  const minRoe = sp.minRoe ? Number(sp.minRoe) : -9999;
  const maxPer = sp.maxPer ? Number(sp.maxPer) : 99999;
  const minRS = sp.minRS ? Number(sp.minRS) : 0;
  const requireTrendTemplate = sp.trendTemplate === "1";
  const requireVcp = sp.vcp === "1";
  const strategy = sp.strategy ?? "";
  const sortKey = sp.sort ?? "growth";

  let authError: string | null = null;
  try {
    await syncListedInfoIfStale();
  } catch (e) {
    if (e instanceof JQuantsAuthError) authError = e.message;
  }

  // Get all small-cap stocks
  const smallStocks = await prisma.listedStock.findMany({
    where: { scaleCategory: { in: SMALL_SCALES } },
    select: {
      code: true,
      ticker: true,
      name: true,
      sector33Name: true,
      marketName: true,
      scaleCategory: true,
    },
  });
  const codes = smallStocks.map((s) => s.code);

  // Get latest financial cache per code (max fiscalYearEnd)
  const allFin = await prisma.financialCache.findMany({
    where: { code: { in: codes } },
    orderBy: { fiscalYearEnd: "desc" },
  });
  const latestFinByCode = new Map<string, (typeof allFin)[number]>();
  for (const f of allFin) {
    if (!latestFinByCode.has(f.code)) latestFinByCode.set(f.code, f);
  }

  // Get forecasts for all small caps
  const allForecasts = await prisma.forecast.findMany({
    where: { code: { in: codes } },
  });
  const forecastByCode = new Map(allForecasts.map((f) => [f.code, f]));

  // Momentum (RS Rating raw score + Trend Template technical score) — Yahoo-
  // sourced, refreshed independently of J-Quants financials.
  const allMomentum = await prisma.momentum.findMany({
    where: { code: { in: codes } },
  });
  const momentumByCode = new Map(allMomentum.map((m) => [m.code, m]));
  const rsRatings = computeRSRatings(
    allMomentum.map((m) => ({ code: m.code, rsRaw: m.rsRaw })),
  );
  const withMomentumCount = allMomentum.length;

  // Join + filter
  type Row = {
    code: string;
    ticker: string;
    name: string;
    sector33Name: string | null;
    marketName: string | null;
    scaleCategory: string | null;
    salesYoY: number | null;
    profitYoY: number | null;
    forecastSalesYoY: number | null;
    forecastProfitYoY: number | null;
    netSales: number | null;
    netIncome: number | null;
    fiscalYearEnd: string | null;
    hasFinancials: boolean;
  };

  const allRows: (Row & {
    score: number | null;
    per: number | null;
    roe: number | null;
    rsRating: number | null;
    technicalScore: number | null;
    technicalPass: boolean;
    trendTemplatePass: boolean;
    vcpPass: boolean;
    pivot: number | null;
    return1m: number | null;
  })[] = smallStocks.map((s) => {
    const f = latestFinByCode.get(s.code);
    const fc = forecastByCode.get(s.code);
    const mom = momentumByCode.get(s.code);
    const price = mom?.price ?? null;
    const eps = f?.eps ?? null;
    const per = price != null && eps != null && eps !== 0 ? price / eps : null;
    const roe =
      f?.netIncome != null && f?.equity != null && f.equity !== 0
        ? (f.netIncome / f.equity) * 100
        : null;
    const equityRatio = f?.equityRatio != null ? f.equityRatio * 100 : null;
    const scoreObj = f
      ? investmentScore({
          salesYoY: f.salesYoY,
          roe,
          per,
          equityRatio,
          forecastSalesYoY: fc?.salesYoYImplied ?? null,
        })
      : null;
    const rsRating = rsRatings.get(s.code) ?? null;
    const technicalScore = mom?.technicalScore ?? null;
    const technicalPass = mom?.technicalPass ?? false;
    const trendTemplatePass = technicalPass && (rsRating ?? 0) >= 70;
    return {
      code: s.code,
      ticker: s.ticker,
      name: s.name,
      sector33Name: s.sector33Name,
      marketName: s.marketName,
      scaleCategory: s.scaleCategory,
      salesYoY: f?.salesYoY ?? null,
      profitYoY: f?.profitYoY ?? null,
      forecastSalesYoY: fc?.salesYoYImplied ?? null,
      forecastProfitYoY: fc?.profitYoYImplied ?? null,
      netSales: f?.netSales ?? null,
      netIncome: f?.netIncome ?? null,
      fiscalYearEnd: f?.fiscalYearEnd ?? null,
      hasFinancials: f != null,
      score: scoreObj?.total ?? null,
      per,
      roe,
      rsRating,
      technicalScore,
      technicalPass,
      trendTemplatePass,
      vcpPass: mom?.vcpPass ?? false,
      pivot: mom?.pivot ?? null,
      return1m: mom?.return1m ?? null,
    };
  });

  const totalSmallStocks = allRows.length;
  const withFinCount = allRows.filter((r) => r.hasFinancials).length;

  let filtered = allRows
    .filter((r) => r.hasFinancials)
    .filter((r) => (r.salesYoY ?? -9999) >= minGrowth)
    .filter((r) => (r.profitYoY ?? -9999) >= minProfit)
    .filter((r) => (r.forecastSalesYoY ?? -9999) >= minFcGrowth)
    .filter((r) => (r.roe ?? -9999) >= minRoe)
    .filter((r) => (r.per ?? 99999) <= maxPer)
    .filter((r) => (r.rsRating ?? 0) >= minRS)
    .filter((r) => !requireTrendTemplate || r.trendTemplatePass)
    .filter((r) => !requireVcp || r.vcpPass);

  // Ozaki-style sector laggard scan: overrides normal filtering, shows only
  // stocks whose sector peers just moved but which haven't reacted yet.
  let laggardGapByCode: Map<string, number> | null = null;
  if (strategy === "laggard") {
    const candidates = findSectorLaggards(
      allRows
        .filter((r) => r.hasFinancials)
        .map((r) => ({
          code: r.code,
          sector33Name: r.sector33Name,
          return1m: r.return1m,
        })),
    );
    laggardGapByCode = new Map(candidates.map((c) => [c.code, c.gap]));
    filtered = filtered.filter((r) => laggardGapByCode!.has(r.code));
  }

  filtered.sort((a, b) => {
    if (strategy === "laggard" && laggardGapByCode) {
      return (laggardGapByCode.get(b.code) ?? 0) - (laggardGapByCode.get(a.code) ?? 0);
    }
    if (sortKey === "profit") return (b.profitYoY ?? -9999) - (a.profitYoY ?? -9999);
    if (sortKey === "fcGrowth")
      return (b.forecastSalesYoY ?? -9999) - (a.forecastSalesYoY ?? -9999);
    if (sortKey === "score") return (b.score ?? -1) - (a.score ?? -1);
    if (sortKey === "rs") return (b.rsRating ?? -1) - (a.rsRating ?? -1);
    if (sortKey === "ticker") return a.ticker.localeCompare(b.ticker);
    // default: growth
    return (b.salesYoY ?? -9999) - (a.salesYoY ?? -9999);
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">スクリーナー</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
          中小型株（TOPIX Small 1 / Small 2）から成長率・価格モメンタムで候補を発掘
        </p>
      </header>

      {authError && (
        <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-5 py-4 text-sm text-red-700 dark:text-red-400">
          <div className="font-semibold mb-1">J-Quants 認証エラー</div>
          <div>{authError}</div>
        </div>
      )}

      <section className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-5 space-y-4">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h2 className="text-sm font-semibold">対象ユニバース</h2>
          <span className="text-xs text-neutral-500">
            小型株 {totalSmallStocks}社 / 財務取得済 {withFinCount}社 / 価格モメンタム取得済{" "}
            {withMomentumCount}社
          </span>
        </div>
        <div className="text-xs text-neutral-600 dark:text-neutral-400">
          財務データ(J-Quants、レート制限あり)と価格モメンタム(Yahoo Finance、高速)は別々に取得します。
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <BulkSyncButton />
          <MomentumSyncButton />
        </div>
      </section>

      <PresetButtons />

      <div className="flex items-center gap-2 flex-wrap text-xs">
        <a
          href={`/api/screener-csv?growth=${minGrowth}&profit=${minProfit > -1000 ? minProfit : ""}`}
          className="rounded-full border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-3 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition"
        >
          📥 CSVダウンロード
        </a>
        <span className="text-neutral-500">取得済の小型株を現在のフィルタで出力</span>
      </div>

      <FilterForm
        currentGrowth={sp.growth ?? ""}
        currentProfit={sp.profit ?? ""}
        currentFcGrowth={sp.fcGrowth ?? ""}
        currentMinRoe={sp.minRoe ?? ""}
        currentMaxPer={sp.maxPer ?? ""}
        currentMinRS={sp.minRS ?? ""}
        currentTrendTemplate={requireTrendTemplate}
        currentSort={sortKey}
      />

      <section>
        <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-sm font-semibold">
            ヒット {filtered.length}件
            {strategy === "laggard" && (
              <span className="text-xs font-normal text-neutral-500 ml-2">
                （尾崎式: セクター出遅れスキャン）
              </span>
            )}
          </h2>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-neutral-500">
            {withFinCount === 0
              ? "まず上のボタンで財務データを取得してください"
              : "条件にヒットする銘柄がありません。フィルタを緩めてみてください。"}
          </div>
        ) : (
          <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 dark:bg-neutral-800/50 text-neutral-600 dark:text-neutral-400">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">銘柄</th>
                    <th className="text-right px-3 py-2 font-medium whitespace-nowrap" title="投資魅力スコア (0-100)">⭐スコア</th>
                    <th className="text-right px-3 py-2 font-medium whitespace-nowrap" title="価格モメンタムの百分位 (1-99、IBD RS Rating方式)">RS</th>
                    <th className="text-center px-3 py-2 font-medium whitespace-nowrap" title="Minervini Trend Template (技術7条件+RS≥70)">TT</th>
                    <th className="text-center px-3 py-2 font-medium whitespace-nowrap" title="VCPセットアップ (高値付近で収縮+出来高枯れ)。数字はピボット(ブレイクアウト水準)">VCP</th>
                    <th className="text-left px-3 py-2 font-medium">業種</th>
                    <th className="text-right px-3 py-2 font-medium whitespace-nowrap">直近売上</th>
                    <th className="text-right px-3 py-2 font-medium whitespace-nowrap">売上YoY</th>
                    <th className="text-right px-3 py-2 font-medium whitespace-nowrap">純利益YoY</th>
                    <th className="text-right px-3 py-2 font-medium whitespace-nowrap">予想売上YoY</th>
                    <th className="text-left px-3 py-2 font-medium whitespace-nowrap">期末</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5 dark:divide-white/5">
                  {filtered.slice(0, 200).map((r) => (
                    <tr key={r.code} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/30">
                      <td className="px-3 py-2">
                        <Link
                          href={`/stocks/${r.code}`}
                          className="font-medium hover:underline"
                        >
                          <span className="font-mono text-neutral-500 mr-2">{r.ticker}</span>
                          {r.name}
                        </Link>
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums font-bold ${
                          r.score == null ? "text-neutral-400" : scoreColor(r.score)
                        }`}
                      >
                        {r.score != null ? r.score.toFixed(0) : "—"}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums font-bold ${
                          r.rsRating == null ? "text-neutral-400" : rsRatingColor(r.rsRating)
                        }`}
                      >
                        {r.rsRating ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {r.technicalScore != null ? (
                          <span
                            title={`技術条件 ${r.technicalScore}/7`}
                            className={
                              r.trendTemplatePass
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-neutral-400"
                            }
                          >
                            {r.trendTemplatePass ? "✓" : `${r.technicalScore}/7`}
                          </span>
                        ) : (
                          <span className="text-neutral-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center text-xs tabular-nums">
                        {r.vcpPass ? (
                          <span
                            className="text-emerald-600 dark:text-emerald-400 font-semibold"
                            title={`ピボット(ブレイクアウト水準): ¥${r.pivot?.toLocaleString() ?? "—"}`}
                          >
                            🧨 ¥{r.pivot != null ? Math.round(r.pivot).toLocaleString() : "—"}
                          </span>
                        ) : (
                          <span className="text-neutral-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-neutral-500">
                        {r.sector33Name ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatYen(r.netSales, { compact: true })}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums font-semibold ${
                          (r.salesYoY ?? 0) > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : (r.salesYoY ?? 0) < 0
                              ? "text-red-600 dark:text-red-400"
                              : ""
                        }`}
                      >
                        {formatPercent(r.salesYoY)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          (r.profitYoY ?? 0) > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : (r.profitYoY ?? 0) < 0
                              ? "text-red-600 dark:text-red-400"
                              : ""
                        }`}
                      >
                        {formatPercent(r.profitYoY)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          (r.forecastSalesYoY ?? 0) > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : (r.forecastSalesYoY ?? 0) < 0
                              ? "text-red-600 dark:text-red-400"
                              : ""
                        }`}
                      >
                        {formatPercent(r.forecastSalesYoY)}
                      </td>
                      <td className="px-3 py-2 text-xs text-neutral-500 whitespace-nowrap">
                        {r.fiscalYearEnd ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length > 200 && (
              <div className="px-4 py-2 text-xs text-neutral-500 border-t">
                上位200件を表示中（全{filtered.length}件中）
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function PresetButtons() {
  const presets: Array<{ label: string; emoji: string; href: string; desc: string }> = [
    {
      emoji: "🏆",
      label: "SEPA (王道)",
      href: "/screener?growth=20&minRoe=10&trendTemplate=1&sort=rs",
      desc: "CAN SLIM財務基準+RS Rating+Trend Template全通過",
    },
    {
      emoji: "🧨",
      label: "VCPセットアップ",
      href: "/screener?vcp=1&minRS=60&sort=rs",
      desc: "高値付近で値幅収縮+出来高枯れ。ピボット超えがエントリー候補",
    },
    {
      emoji: "🔍",
      label: "出遅れ(尾崎式)",
      href: "/screener?strategy=laggard",
      desc: "同業他社が急騰したのにまだ反応していない銘柄",
    },
    {
      emoji: "🚀",
      label: "高成長",
      href: "/screener?growth=20&sort=growth",
      desc: "売上YoY ≥20%",
    },
    {
      emoji: "💎",
      label: "高成長＋利益拡大",
      href: "/screener?growth=15&profit=15&sort=profit",
      desc: "売上+15%, 利益+15%",
    },
    {
      emoji: "🌱",
      label: "黒字化勢い",
      href: "/screener?profit=50&sort=profit",
      desc: "純利益YoY ≥50%",
    },
    {
      emoji: "🔮",
      label: "予想加速",
      href: "/screener?fcGrowth=15&sort=fcGrowth",
      desc: "会社予想売上YoY ≥15%",
    },
    {
      emoji: "💰",
      label: "高ROE割安",
      href: "/screener?minRoe=15&maxPer=15&sort=score",
      desc: "ROE≥15%, PER≤15倍",
    },
    {
      emoji: "🎯",
      label: "テンバガー候補",
      href: "/screener?growth=30&minRoe=10&sort=growth",
      desc: "売上+30%, ROE≥10%",
    },
    {
      emoji: "📊",
      label: "全銘柄",
      href: "/screener",
      desc: "フィルタなし",
    },
  ];
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-neutral-500">クイック:</span>
      {presets.map((p) => (
        <Link
          key={p.label}
          href={p.href}
          className="text-xs rounded-full border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-3 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition"
          title={p.desc}
        >
          {p.emoji} {p.label}
        </Link>
      ))}
    </div>
  );
}

function FilterForm({
  currentGrowth,
  currentProfit,
  currentFcGrowth,
  currentMinRoe,
  currentMaxPer,
  currentMinRS,
  currentTrendTemplate,
  currentSort,
}: {
  currentGrowth: string;
  currentProfit: string;
  currentFcGrowth: string;
  currentMinRoe: string;
  currentMaxPer: string;
  currentMinRS: string;
  currentTrendTemplate: boolean;
  currentSort: string;
}) {
  return (
    <form
      action="/screener"
      method="get"
      className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-5"
    >
      <h2 className="text-sm font-semibold mb-3">フィルタ</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="growth" className="block text-xs font-medium mb-1.5 text-neutral-600 dark:text-neutral-400">
            売上YoY 最低 (%)
          </label>
          <input
            type="number"
            id="growth"
            name="growth"
            step="1"
            defaultValue={currentGrowth}
            placeholder="0"
            className="w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white"
          />
          <p className="text-xs text-neutral-500 mt-1">例: 20 で20%超のみ</p>
        </div>
        <div>
          <label htmlFor="profit" className="block text-xs font-medium mb-1.5 text-neutral-600 dark:text-neutral-400">
            純利益YoY 最低 (%)
          </label>
          <input
            type="number"
            id="profit"
            name="profit"
            step="1"
            defaultValue={currentProfit}
            placeholder="(無制限)"
            className="w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white"
          />
          <p className="text-xs text-neutral-500 mt-1">空欄でフィルタなし</p>
        </div>
        <div>
          <label htmlFor="fcGrowth" className="block text-xs font-medium mb-1.5 text-neutral-600 dark:text-neutral-400">
            予想売上YoY 最低 (%)
          </label>
          <input
            type="number"
            id="fcGrowth"
            name="fcGrowth"
            step="1"
            defaultValue={currentFcGrowth}
            placeholder="(無制限)"
            className="w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white"
          />
          <p className="text-xs text-neutral-500 mt-1">会社予想ベース</p>
        </div>
        <div>
          <label htmlFor="minRoe" className="block text-xs font-medium mb-1.5 text-neutral-600 dark:text-neutral-400">
            ROE 最低 (%)
          </label>
          <input
            type="number"
            id="minRoe"
            name="minRoe"
            step="1"
            defaultValue={currentMinRoe}
            placeholder="(無制限)"
            className="w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white"
          />
          <p className="text-xs text-neutral-500 mt-1">資本効率の高さ</p>
        </div>
        <div>
          <label htmlFor="maxPer" className="block text-xs font-medium mb-1.5 text-neutral-600 dark:text-neutral-400">
            PER 最大 (倍)
          </label>
          <input
            type="number"
            id="maxPer"
            name="maxPer"
            step="1"
            defaultValue={currentMaxPer}
            placeholder="(無制限)"
            className="w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white"
          />
          <p className="text-xs text-neutral-500 mt-1">割安さ</p>
        </div>
        <div>
          <label htmlFor="minRS" className="block text-xs font-medium mb-1.5 text-neutral-600 dark:text-neutral-400">
            RS Rating 最低 (1-99)
          </label>
          <input
            type="number"
            id="minRS"
            name="minRS"
            step="1"
            min="1"
            max="99"
            defaultValue={currentMinRS}
            placeholder="(無制限)"
            className="w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white"
          />
          <p className="text-xs text-neutral-500 mt-1">価格モメンタムの強さ</p>
        </div>
        <div className="flex items-end pb-1.5">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="trendTemplate"
              value="1"
              defaultChecked={currentTrendTemplate}
              className="rounded border-black/25 dark:border-white/25"
            />
            Trend Template全通過のみ
          </label>
        </div>
        <div>
          <label htmlFor="sort" className="block text-xs font-medium mb-1.5 text-neutral-600 dark:text-neutral-400">
            並び順
          </label>
          <select
            id="sort"
            name="sort"
            defaultValue={currentSort}
            className="w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white"
          >
            <option value="score">⭐スコア (高い順)</option>
            <option value="rs">RS Rating (高い順)</option>
            <option value="growth">売上YoY (高い順)</option>
            <option value="profit">純利益YoY (高い順)</option>
            <option value="fcGrowth">予想売上YoY (高い順)</option>
            <option value="ticker">銘柄コード昇順</option>
          </select>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <button
          type="submit"
          className="rounded-lg bg-neutral-900 dark:bg-white px-4 py-1.5 text-white dark:text-neutral-900 text-sm font-medium hover:opacity-90 transition"
        >
          適用
        </button>
        <Link
          href="/screener"
          className="rounded-lg border border-black/15 dark:border-white/15 px-4 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
        >
          リセット
        </Link>
      </div>
    </form>
  );
}
