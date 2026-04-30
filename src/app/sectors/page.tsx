import Link from "next/link";
import { prisma } from "@/lib/db";
import { syncListedInfoIfStale } from "@/lib/sync";
import { JQuantsAuthError } from "@/lib/jquants";
import { formatPercent } from "@/lib/financial-metrics";

type SectorAgg = {
  sector33Name: string;
  count: number;
  withFinancials: number;
  avgSalesYoY: number | null;
  avgProfitYoY: number | null;
  topGrowers: Array<{ code: string; ticker: string; name: string; salesYoY: number }>;
};

export default async function SectorsPage() {
  let authError: string | null = null;
  try {
    await syncListedInfoIfStale();
  } catch (e) {
    if (e instanceof JQuantsAuthError) authError = e.message;
  }

  const stocks = await prisma.listedStock.findMany({
    where: { sector33Name: { not: null } },
    select: {
      code: true,
      ticker: true,
      name: true,
      sector33Name: true,
      scaleCategory: true,
    },
  });

  const allFin = await prisma.financialCache.findMany({
    where: { code: { in: stocks.map((s) => s.code) } },
    orderBy: { fiscalYearEnd: "desc" },
  });
  const latestFinByCode = new Map<string, (typeof allFin)[number]>();
  for (const f of allFin) {
    if (!latestFinByCode.has(f.code)) latestFinByCode.set(f.code, f);
  }

  const sectorMap = new Map<string, SectorAgg>();
  for (const s of stocks) {
    if (!s.sector33Name) continue;
    const key = s.sector33Name;
    if (!sectorMap.has(key)) {
      sectorMap.set(key, {
        sector33Name: key,
        count: 0,
        withFinancials: 0,
        avgSalesYoY: null,
        avgProfitYoY: null,
        topGrowers: [],
      });
    }
    const agg = sectorMap.get(key)!;
    agg.count += 1;

    const f = latestFinByCode.get(s.code);
    if (f && (f.salesYoY != null || f.profitYoY != null)) {
      agg.withFinancials += 1;
      if (f.salesYoY != null) {
        agg.topGrowers.push({
          code: s.code,
          ticker: s.ticker,
          name: s.name,
          salesYoY: f.salesYoY,
        });
      }
    }
  }

  // Compute averages and sort top growers
  for (const [, agg] of sectorMap) {
    const sales: number[] = [];
    const profits: number[] = [];
    for (const s of stocks.filter((x) => x.sector33Name === agg.sector33Name)) {
      const f = latestFinByCode.get(s.code);
      if (f?.salesYoY != null) sales.push(f.salesYoY);
      if (f?.profitYoY != null) profits.push(f.profitYoY);
    }
    agg.avgSalesYoY = sales.length > 0 ? sales.reduce((a, b) => a + b, 0) / sales.length : null;
    agg.avgProfitYoY =
      profits.length > 0 ? profits.reduce((a, b) => a + b, 0) / profits.length : null;
    agg.topGrowers.sort((a, b) => b.salesYoY - a.salesYoY);
    agg.topGrowers = agg.topGrowers.slice(0, 3);
  }

  const sectors = Array.from(sectorMap.values()).sort((a, b) => {
    // Sectors with data first, then by avgSalesYoY desc, finally by count desc
    if (a.avgSalesYoY != null && b.avgSalesYoY == null) return -1;
    if (a.avgSalesYoY == null && b.avgSalesYoY != null) return 1;
    if (a.avgSalesYoY != null && b.avgSalesYoY != null) {
      return b.avgSalesYoY - a.avgSalesYoY;
    }
    return b.count - a.count;
  });

  const withDataCount = sectors.filter((s) => s.avgSalesYoY != null).length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">業界分析</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
          東証33業種別の成長率ランキング
        </p>
      </header>

      {authError && (
        <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-5 py-4 text-sm text-red-700 dark:text-red-400">
          <div className="font-semibold mb-1">J-Quants 認証エラー</div>
          <div>{authError}</div>
        </div>
      )}

      {withDataCount === 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-400">
          業界別の成長率を集計するには、まず
          <Link href="/screener" className="underline mx-1">スクリーナー</Link>
          で財務データを取得してください（小型株100件のバルク取得を実行）。
        </div>
      )}

      <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-800/50 text-neutral-600 dark:text-neutral-400">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">業種</th>
                <th className="text-right px-4 py-2.5 font-medium">銘柄数</th>
                <th className="text-right px-4 py-2.5 font-medium">財務取得済</th>
                <th className="text-right px-4 py-2.5 font-medium">平均売上YoY</th>
                <th className="text-right px-4 py-2.5 font-medium">平均利益YoY</th>
                <th className="text-left px-4 py-2.5 font-medium">トップグロワー</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5 dark:divide-white/5">
              {sectors.map((s) => (
                <tr key={s.sector33Name} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/30">
                  <td className="px-4 py-2.5 font-medium">{s.sector33Name}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-neutral-500">
                    {s.count}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-neutral-500">
                    {s.withFinancials}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right tabular-nums font-semibold ${
                      (s.avgSalesYoY ?? 0) > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : (s.avgSalesYoY ?? 0) < 0
                          ? "text-red-600 dark:text-red-400"
                          : ""
                    }`}
                  >
                    {formatPercent(s.avgSalesYoY)}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right tabular-nums ${
                      (s.avgProfitYoY ?? 0) > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : (s.avgProfitYoY ?? 0) < 0
                          ? "text-red-600 dark:text-red-400"
                          : ""
                    }`}
                  >
                    {formatPercent(s.avgProfitYoY)}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {s.topGrowers.length > 0 ? (
                      <div className="flex flex-col gap-0.5">
                        {s.topGrowers.map((t) => (
                          <Link
                            key={t.code}
                            href={`/stocks/${t.code}`}
                            className="hover:underline"
                          >
                            <span className="font-mono text-neutral-500 mr-1">
                              {t.ticker}
                            </span>
                            {t.name.length > 12 ? t.name.slice(0, 12) + "…" : t.name}
                            <span className="ml-1 text-emerald-600 dark:text-emerald-400 tabular-nums">
                              +{t.salesYoY.toFixed(1)}%
                            </span>
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
