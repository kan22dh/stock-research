import Link from "next/link";
import { prisma } from "@/lib/db";
import { WatchToggle } from "@/components/watch-toggle";

function pct(latest: number | null, past: number | null): number | null {
  if (latest == null || past == null || past === 0) return null;
  return ((latest - past) / past) * 100;
}

export default async function WatchlistPage() {
  const items = await prisma.watchlist.findMany({
    orderBy: { createdAt: "desc" },
    include: { stock: true },
  });

  // Per-item: latest price, ~1M past price, latest financials, latest forecast
  const enriched = await Promise.all(
    items.map(async (w) => {
      const [prices, latestFin, fc] = await Promise.all([
        prisma.priceCache.findMany({
          where: { code: w.code },
          orderBy: { date: "desc" },
          take: 25, // ~1 month of trading days
        }),
        prisma.financialCache.findFirst({
          where: { code: w.code },
          orderBy: { fiscalYearEnd: "desc" },
        }),
        prisma.forecast.findUnique({ where: { code: w.code } }),
      ]);
      const latestPrice = prices[0]?.close ?? null;
      const past1M = prices[prices.length - 1]?.close ?? null;
      const ret1M = pct(latestPrice, past1M);
      return { ...w, latestPrice, ret1M, latestFin, forecast: fc };
    }),
  );

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
        <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 dark:bg-neutral-800/50 text-neutral-600 dark:text-neutral-400">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">銘柄</th>
                  <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">株価</th>
                  <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">1ヶ月</th>
                  <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">売上YoY</th>
                  <th className="text-right px-4 py-2.5 font-medium whitespace-nowrap">予想売上YoY</th>
                  <th className="text-left px-4 py-2.5 font-medium">業種</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5 dark:divide-white/5">
                {enriched.map((w) => (
                  <tr key={w.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/30">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/stocks/${w.code}`}
                        className="hover:underline flex items-center gap-2 min-w-0"
                      >
                        <span className="font-mono text-neutral-500 shrink-0">{w.stock.ticker}</span>
                        <span className="truncate font-medium">{w.stock.name}</span>
                      </Link>
                      {w.note && (
                        <div className="text-xs text-neutral-500 mt-0.5">{w.note}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                      {w.latestPrice != null
                        ? `${w.latestPrice.toLocaleString("ja-JP")}円`
                        : "—"}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right tabular-nums whitespace-nowrap font-medium ${
                        w.ret1M != null
                          ? w.ret1M > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : w.ret1M < 0
                              ? "text-red-600 dark:text-red-400"
                              : ""
                          : ""
                      }`}
                    >
                      {w.ret1M != null
                        ? `${w.ret1M > 0 ? "+" : ""}${w.ret1M.toFixed(1)}%`
                        : "—"}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right tabular-nums whitespace-nowrap ${
                        (w.latestFin?.salesYoY ?? 0) > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : (w.latestFin?.salesYoY ?? 0) < 0
                            ? "text-red-600 dark:text-red-400"
                            : ""
                      }`}
                    >
                      {w.latestFin?.salesYoY != null
                        ? `${w.latestFin.salesYoY > 0 ? "+" : ""}${w.latestFin.salesYoY.toFixed(1)}%`
                        : "—"}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right tabular-nums whitespace-nowrap ${
                        (w.forecast?.salesYoYImplied ?? 0) > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : (w.forecast?.salesYoYImplied ?? 0) < 0
                            ? "text-red-600 dark:text-red-400"
                            : ""
                      }`}
                    >
                      {w.forecast?.salesYoYImplied != null
                        ? `${w.forecast.salesYoYImplied > 0 ? "+" : ""}${w.forecast.salesYoYImplied.toFixed(1)}%`
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-neutral-500 whitespace-nowrap">
                      {w.stock.sector33Name ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <WatchToggle code={w.code} initialWatched={true} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
