import Link from "next/link";
import { prisma } from "@/lib/db";
import { syncListedInfoIfStale } from "@/lib/sync";
import { JQuantsAuthError } from "@/lib/jquants";
import { BulkSyncButton } from "@/components/bulk-sync-button";
import { formatYen, formatPercent } from "@/lib/financial-metrics";
import { investmentScore, scoreColor } from "@/lib/investment-score";

const SMALL_SCALES = ["TOPIX Small 1", "TOPIX Small 2"];

type SearchParams = Promise<{
  growth?: string;     // min sales YoY %
  profit?: string;     // min profit YoY %
  fcGrowth?: string;   // min forecast sales YoY %
  sort?: string;       // "growth" | "profit" | "fcGrowth" | "ticker"
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

  // Get latest financial cache per code (max fiscalYearEnd)
  const allFin = await prisma.financialCache.findMany({
    where: { code: { in: smallStocks.map((s) => s.code) } },
    orderBy: { fiscalYearEnd: "desc" },
  });
  const latestFinByCode = new Map<string, (typeof allFin)[number]>();
  for (const f of allFin) {
    if (!latestFinByCode.has(f.code)) latestFinByCode.set(f.code, f);
  }

  // Get forecasts for all small caps
  const allForecasts = await prisma.forecast.findMany({
    where: { code: { in: smallStocks.map((s) => s.code) } },
  });
  const forecastByCode = new Map(allForecasts.map((f) => [f.code, f]));

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

  // Get latest price per code for PER calculation in score
  const latestPrices = await prisma.priceCache.findMany({
    where: { code: { in: smallStocks.map((s) => s.code) } },
    orderBy: { date: "desc" },
  });
  const latestPriceByCode = new Map<string, number>();
  for (const p of latestPrices) {
    if (!latestPriceByCode.has(p.code)) latestPriceByCode.set(p.code, p.close);
  }

  const allRows: (Row & { score: number | null })[] = smallStocks.map((s) => {
    const f = latestFinByCode.get(s.code);
    const fc = forecastByCode.get(s.code);
    const price = latestPriceByCode.get(s.code) ?? null;
    const eps = f?.eps ?? null;
    const per =
      price != null && eps != null && eps !== 0 ? price / eps : null;
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
    };
  });

  const totalSmallStocks = allRows.length;
  const withFinCount = allRows.filter((r) => r.hasFinancials).length;

  const filtered = allRows
    .filter((r) => r.hasFinancials)
    .filter((r) => (r.salesYoY ?? -9999) >= minGrowth)
    .filter((r) => (r.profitYoY ?? -9999) >= minProfit)
    .filter((r) => (r.forecastSalesYoY ?? -9999) >= minFcGrowth);

  filtered.sort((a, b) => {
    if (sortKey === "profit") return (b.profitYoY ?? -9999) - (a.profitYoY ?? -9999);
    if (sortKey === "fcGrowth")
      return (b.forecastSalesYoY ?? -9999) - (a.forecastSalesYoY ?? -9999);
    if (sortKey === "score") return (b.score ?? -1) - (a.score ?? -1);
    if (sortKey === "ticker") return a.ticker.localeCompare(b.ticker);
    // default: growth
    return (b.salesYoY ?? -9999) - (a.salesYoY ?? -9999);
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">スクリーナー</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
          中小型株（TOPIX Small 1 / Small 2）から成長率で候補を発掘
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
            小型株 {totalSmallStocks}社 / 財務取得済 {withFinCount}社
          </span>
        </div>
        <div className="text-xs text-neutral-600 dark:text-neutral-400">
          スクリーニングするには財務データを事前に取得する必要があります（J-Quantsの個別銘柄APIから）。
          ボタンを押すと小型株30件の財務データを取得します（J-Quants無料プランのレート制限に配慮、約3分）。
          押すたびに未取得の銘柄が追加されます（取得済はスキップ）。
        </div>
        <BulkSyncButton />
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
        currentSort={sortKey}
      />

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-semibold">
            ヒット {filtered.length}件
            {(minGrowth > 0 || minProfit > -1000) && (
              <span className="text-xs font-normal text-neutral-500 ml-2">
                （フィルタ適用中）
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
  currentSort,
}: {
  currentGrowth: string;
  currentProfit: string;
  currentFcGrowth: string;
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
