import Link from "next/link";
import { prisma } from "@/lib/db";
import { investmentScore, scoreColor } from "@/lib/investment-score";
import { fetchYahoo } from "@/lib/yahoo-finance";

export const revalidate = 300;

export async function TopByScore() {
  const stocks = await prisma.listedStock.findMany({
    where: {
      scaleCategory: { in: ["TOPIX Small 1", "TOPIX Small 2"] },
      financials: { some: {} },
    },
    include: {
      financials: { orderBy: { fiscalYearEnd: "desc" }, take: 1 },
      forecast: true,
    },
  });

  // Score with LIVE price (Yahoo) for accurate PER. Fall back to most recent
  // cached close if Yahoo unavailable. Limit concurrent Yahoo calls for safety.
  type Scored = { code: string; ticker: string; name: string; sector33Name: string | null; total: number };
  const scored: Scored[] = [];
  // Process all in parallel — Yahoo handles concurrent calls fine
  const results = await Promise.all(
    stocks.map(async (s) => {
      const f = s.financials[0];
      if (!f) return null;
      const yahoo = await fetchYahoo(s.code, "1mo", 300).catch(() => null);
      const price = yahoo?.regularMarketPrice ?? null;
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
      if (score == null) return null;
      return {
        code: s.code,
        ticker: s.ticker,
        name: s.name,
        sector33Name: s.sector33Name,
        total: score.total,
      } as Scored;
    }),
  );
  for (const r of results) if (r) scored.push(r);

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
