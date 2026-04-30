import Link from "next/link";
import { prisma } from "@/lib/db";

export default async function WatchlistPage() {
  const items = await prisma.watchlist.findMany({
    orderBy: { createdAt: "desc" },
    include: { stock: true },
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">ウォッチリスト</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
          気になる銘柄を保存（{items.length}件）
        </p>
      </header>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-black/15 dark:border-white/15 p-12 text-center text-sm text-neutral-500">
          まだウォッチ中の銘柄がありません。
          <Link href="/" className="ml-1 underline hover:text-neutral-900 dark:hover:text-white">
            銘柄検索
          </Link>
          から追加してください。
        </div>
      ) : (
        <ul className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 divide-y divide-black/5 dark:divide-white/5 overflow-hidden">
          {items.map((w) => (
            <li key={w.id}>
              <Link
                href={`/stocks/${w.code}`}
                className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    <span className="font-mono text-neutral-500 mr-2">
                      {w.stock.ticker}
                    </span>
                    {w.stock.name}
                  </div>
                  <div className="text-xs text-neutral-500 mt-0.5 flex gap-2 flex-wrap">
                    {w.stock.sector33Name && <span>{w.stock.sector33Name}</span>}
                    {w.stock.marketName && <span>・{w.stock.marketName}</span>}
                    {w.stock.scaleCategory && <span>・{w.stock.scaleCategory}</span>}
                  </div>
                </div>
                <span className="text-neutral-400 shrink-0">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
