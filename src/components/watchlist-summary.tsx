import Link from "next/link";
import { prisma } from "@/lib/db";
import { fetchYahoo } from "@/lib/yahoo-finance";

export const revalidate = 60;

export async function WatchlistSummary() {
  const watch = await prisma.watchlist.findMany({
    include: { stock: true },
  });
  if (watch.length === 0) return null;

  const enriched = await Promise.all(
    watch.map(async (w) => {
      const y = await fetchYahoo(w.code, "1mo", 60).catch(() => null);
      const dayChange =
        y?.regularMarketPrice != null && y?.previousClose != null && y.previousClose !== 0
          ? ((y.regularMarketPrice - y.previousClose) / y.previousClose) * 100
          : null;
      return { ...w, latestPrice: y?.regularMarketPrice ?? null, dayChange };
    }),
  );

  const valid = enriched.filter((e) => e.dayChange != null);
  if (valid.length === 0) return null;

  const avgChange = valid.reduce((s, e) => s + (e.dayChange ?? 0), 0) / valid.length;
  const top = [...valid].sort((a, b) => (b.dayChange ?? 0) - (a.dayChange ?? 0))[0];
  const bottom = [...valid].sort((a, b) => (a.dayChange ?? 0) - (b.dayChange ?? 0))[0];
  const positives = valid.filter((e) => (e.dayChange ?? 0) > 0).length;
  const negatives = valid.filter((e) => (e.dayChange ?? 0) < 0).length;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          📊 ウォッチリスト本日のサマリー
        </h2>
        <Link
          href="/watchlist"
          className="text-xs text-neutral-500 hover:underline"
        >
          すべて見る →
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 px-4 py-3">
          <div className="text-xs text-neutral-500">平均前日比</div>
          <div
            className={`text-2xl font-bold tabular-nums mt-0.5 ${
              avgChange > 0
                ? "text-emerald-600 dark:text-emerald-400"
                : avgChange < 0
                  ? "text-red-600 dark:text-red-400"
                  : ""
            }`}
          >
            {avgChange > 0 ? "+" : ""}
            {avgChange.toFixed(2)}%
          </div>
          <div className="text-xs text-neutral-500 mt-0.5">
            {positives}社上昇 / {negatives}社下落 ({valid.length}社中)
          </div>
        </div>

        {top && (
          <Link
            href={`/stocks/${top.code}`}
            className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/30 dark:to-neutral-900 px-4 py-3 hover:shadow transition"
          >
            <div className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
              ▲ 本日のトップ
            </div>
            <div className="text-base font-semibold mt-0.5 truncate">
              <span className="font-mono text-neutral-500 mr-1">{top.stock.ticker}</span>
              {top.stock.name}
            </div>
            <div className="text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400 mt-0.5">
              +{(top.dayChange ?? 0).toFixed(2)}%
            </div>
          </Link>
        )}

        {bottom && bottom.code !== top?.code && (
          <Link
            href={`/stocks/${bottom.code}`}
            className="rounded-xl border border-red-200 dark:border-red-900/50 bg-gradient-to-br from-red-50 to-white dark:from-red-950/30 dark:to-neutral-900 px-4 py-3 hover:shadow transition"
          >
            <div className="text-xs text-red-700 dark:text-red-400 flex items-center gap-1">
              ▼ 本日の下落トップ
            </div>
            <div className="text-base font-semibold mt-0.5 truncate">
              <span className="font-mono text-neutral-500 mr-1">{bottom.stock.ticker}</span>
              {bottom.stock.name}
            </div>
            <div className="text-xl font-bold tabular-nums text-red-600 dark:text-red-400 mt-0.5">
              {(bottom.dayChange ?? 0).toFixed(2)}%
            </div>
          </Link>
        )}
      </div>
    </section>
  );
}
