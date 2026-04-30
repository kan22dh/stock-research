import Link from "next/link";
import { prisma } from "@/lib/db";
import { StockSearch } from "@/components/stock-search";

export default async function Home() {
  const watch = await prisma.watchlist.findMany({
    take: 10,
    orderBy: { createdAt: "desc" },
    include: { stock: true },
  });

  const stockCount = await prisma.listedStock.count();

  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      <section className="pt-4">
        <h1 className="text-3xl font-bold tracking-tight">銘柄検索</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-2">
          コードまたは銘柄名で個別株を検索し、ローソクチャートと財務指標を1画面で確認できます。
        </p>
      </section>

      <StockSearch />

      {stockCount === 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-400">
          上場銘柄リストが未取得です。検索すると自動取得します（初回は数秒かかります）。
        </div>
      )}

      {watch.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">ウォッチリスト</h2>
            <Link
              href="/watchlist"
              className="text-sm text-neutral-600 dark:text-neutral-400 hover:underline"
            >
              すべて見る →
            </Link>
          </div>
          <ul className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 divide-y divide-black/5 dark:divide-white/5 overflow-hidden">
            {watch.map((w) => (
              <li key={w.id}>
                <Link
                  href={`/stocks/${w.code}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      <span className="font-mono text-neutral-500 mr-2">
                        {w.stock.ticker}
                      </span>
                      {w.stock.name}
                    </div>
                    {w.note && (
                      <div className="text-xs text-neutral-500 mt-0.5">{w.note}</div>
                    )}
                  </div>
                  <span className="text-neutral-400 shrink-0">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
