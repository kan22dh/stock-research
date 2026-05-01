import Link from "next/link";
import { prisma } from "@/lib/db";

// Stocks where company forecast YoY > current actual YoY = acceleration expected.
// Limit to small-caps for the user's target.
export async function ForecastAccelerators() {
  const accelerators = await prisma.forecast.findMany({
    where: {
      stock: {
        scaleCategory: { in: ["TOPIX Small 1", "TOPIX Small 2"] },
      },
      salesYoYImplied: { not: null },
    },
    include: {
      stock: {
        include: { financials: { orderBy: { fiscalYearEnd: "desc" }, take: 1 } },
      },
    },
  });

  const ranked = accelerators
    .map((f) => {
      const actual = f.stock.financials[0]?.salesYoY ?? null;
      const forecast = f.salesYoYImplied ?? 0;
      const accel = actual != null ? forecast - actual : forecast;
      return { f, actual, forecast, accel };
    })
    .filter((r) => r.forecast >= 5) // forecast meaningful growth
    .sort((a, b) => b.accel - a.accel)
    .slice(0, 5);

  if (ranked.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          ⏫ 成長加速期待（会社予想 vs 実績）
        </h2>
        <Link
          href="/screener?fcGrowth=15&sort=fcGrowth"
          className="text-xs text-neutral-500 hover:underline"
        >
          スクリーナーで詳細 →
        </Link>
      </div>
      <ul className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 divide-y divide-black/5 dark:divide-white/5 overflow-hidden">
        {ranked.map((r) => (
          <li key={r.f.code}>
            <Link
              href={`/stocks/${r.f.code}`}
              className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition text-sm"
            >
              <div className="min-w-0 flex items-center gap-3 flex-1">
                <span className="font-mono text-neutral-500 shrink-0">
                  {r.f.stock.ticker}
                </span>
                <span className="truncate font-medium">{r.f.stock.name}</span>
                <span className="text-xs text-neutral-500 shrink-0 hidden sm:inline">
                  {r.f.stock.sector33Name}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0 tabular-nums text-xs">
                <span className="text-neutral-500">
                  実績 {r.actual != null ? `${r.actual > 0 ? "+" : ""}${r.actual.toFixed(1)}%` : "—"}
                </span>
                <span className="text-neutral-400">→</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                  予想 {r.forecast > 0 ? "+" : ""}{r.forecast.toFixed(1)}%
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
