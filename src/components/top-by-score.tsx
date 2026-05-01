import Link from "next/link";
import { prisma } from "@/lib/db";
import { investmentScore, scoreColor } from "@/lib/investment-score";

export async function TopByScore() {
  const stocks = await prisma.listedStock.findMany({
    where: {
      scaleCategory: { in: ["TOPIX Small 1", "TOPIX Small 2"] },
      financials: { some: {} },
    },
    include: {
      financials: { orderBy: { fiscalYearEnd: "desc" }, take: 1 },
      forecast: true,
      prices: { orderBy: { date: "desc" }, take: 1 },
    },
  });

  type Scored = { code: string; ticker: string; name: string; sector33Name: string | null; total: number };
  const scored: Scored[] = [];
  for (const s of stocks) {
    const f = s.financials[0];
    if (!f) continue;
    const price = s.prices[0]?.close ?? null;
    const eps = f.eps ?? null;
    const per = price != null && eps != null && eps !== 0 ? price / eps : null;
    const roe =
      f.netIncome != null && f.equity != null && f.equity !== 0
        ? (f.netIncome / f.equity) * 100
        : null;
    const equityRatio = f.equityRatio != null ? f.equityRatio * 100 : null;
    const score = investmentScore({
      salesYoY: f.salesYoY,
      roe,
      per,
      equityRatio,
      forecastSalesYoY: s.forecast?.salesYoYImplied ?? null,
    });
    if (score == null) continue;
    scored.push({
      code: s.code,
      ticker: s.ticker,
      name: s.name,
      sector33Name: s.sector33Name,
      total: score.total,
    });
  }

  scored.sort((a, b) => b.total - a.total);
  const top = scored.slice(0, 5);
  if (top.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          ⭐ 投資魅力スコア上位（小型株）
        </h2>
        <span className="text-xs text-neutral-500">
          成長＋収益＋割安＋安全＋加速の複合 (0-100)
        </span>
      </div>
      <ul className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 divide-y divide-black/5 dark:divide-white/5 overflow-hidden">
        {top.map((s, i) => (
          <li key={s.code}>
            <Link
              href={`/stocks/${s.code}`}
              className="flex items-center justify-between gap-4 px-4 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition text-sm"
            >
              <div className="min-w-0 flex items-center gap-3 flex-1">
                <span className="text-xs text-neutral-400 shrink-0 w-4 text-right tabular-nums">
                  {i + 1}
                </span>
                <span className="font-mono text-neutral-500 shrink-0">
                  {s.ticker}
                </span>
                <span className="truncate font-medium">{s.name}</span>
                <span className="text-xs text-neutral-500 shrink-0 hidden sm:inline">
                  {s.sector33Name}
                </span>
              </div>
              <div className={`text-lg font-bold tabular-nums shrink-0 ${scoreColor(s.total)}`}>
                {s.total.toFixed(0)}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
