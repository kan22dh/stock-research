import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatYen } from "@/lib/financial-metrics";

export async function TopGrowers() {
  const top = await prisma.financialCache.findMany({
    where: {
      salesYoY: { not: null },
      stock: {
        scaleCategory: { in: ["TOPIX Small 1", "TOPIX Small 2"] },
      },
    },
    orderBy: { salesYoY: "desc" },
    take: 5,
    include: { stock: true },
  });

  if (top.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          🚀 取得済の小型株 売上YoY ベスト5
        </h2>
        <Link
          href="/screener?sort=growth"
          className="text-xs text-neutral-500 hover:underline"
        >
          スクリーナーで見る →
        </Link>
      </div>
      <ul className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 divide-y divide-black/5 dark:divide-white/5 overflow-hidden">
        {top.map((t) => (
          <li key={t.code}>
            <Link
              href={`/stocks/${t.code}`}
              className="flex items-center justify-between gap-4 px-4 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition text-sm"
            >
              <div className="min-w-0 flex items-center gap-3 flex-1">
                <span className="font-mono text-neutral-500 shrink-0">
                  {t.stock.ticker}
                </span>
                <span className="truncate font-medium">{t.stock.name}</span>
                <span className="text-xs text-neutral-500 shrink-0 hidden sm:inline">
                  {t.stock.sector33Name}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-neutral-500 hidden md:inline tabular-nums">
                  売上 {formatYen(t.netSales, { compact: true })}
                </span>
                {t.salesYoY != null && (
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold tabular-nums">
                    +{t.salesYoY.toFixed(1)}%
                  </span>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
