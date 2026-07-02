import { Suspense } from "react";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { StockSearch } from "@/components/stock-search";
import { MacroSnapshot } from "@/components/macro-snapshot";
import { TopGrowers } from "@/components/top-growers";
import { ForecastAccelerators } from "@/components/forecast-accelerators";
import { TopByScore } from "@/components/top-by-score";
import { WatchlistSummary } from "@/components/watchlist-summary";
import { GoalTracker } from "@/components/goal-tracker";
import { StopLossAlerts } from "@/components/stop-loss-alerts";

const EXAMPLE_STOCKS = [
  { code: "72030", name: "トヨタ自動車", note: "大型・自動車" },
  { code: "94320", name: "NTT", note: "大型・通信" },
  { code: "62700", name: "SMC", note: "中型・電機" },
];

export default async function Home() {
  const [watch, history, stockCount, finCount] = await Promise.all([
    prisma.watchlist.findMany({
      take: 6,
      orderBy: { createdAt: "desc" },
      include: { stock: true },
    }),
    prisma.browseHistory.findMany({
      take: 6,
      orderBy: { lastViewed: "desc" },
      include: { stock: true },
    }),
    prisma.listedStock.count(),
    prisma.financialCache
      .groupBy({ by: ["code"] })
      .then((g) => g.length),
  ]);
  const dataMaturity = finCount < 10 ? "low" : finCount < 50 ? "med" : "high";

  return (
    <div className="space-y-8">
      <section className="pt-2">
        <h1 className="text-3xl font-bold tracking-tight">銘柄検索</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-2">
          コードまたは銘柄名で個別株を検索し、ローソクチャート・財務指標・AI分析を1画面で確認できます。
        </p>
      </section>

      <StockSearch />

      {stockCount === 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-400">
          上場銘柄リストが未取得です。検索すると自動取得します（初回は数秒かかります）。
        </div>
      )}

      {stockCount > 0 && dataMaturity === "low" && (
        <div className="rounded-lg border border-sky-200 dark:border-sky-900/50 bg-sky-50 dark:bg-sky-950/30 px-4 py-3 text-sm text-sky-800 dark:text-sky-300">
          💡 財務データを取得中（{finCount} / 約30社目安）。
          <Link href="/screener" className="underline mx-1 hover:text-sky-900 dark:hover:text-sky-200">
            スクリーナーの「📊 一括取得」ボタン
          </Link>
          を押すと、投資魅力スコア・トップグロワー等の各ウィジェットが充実します。
        </div>
      )}

      <Suspense fallback={null}>
        <StopLossAlerts />
      </Suspense>

      <Suspense fallback={null}>
        <GoalTracker />
      </Suspense>

      <Suspense fallback={null}>
        <WatchlistSummary />
      </Suspense>

      <Suspense fallback={null}>
        <MacroSnapshot />
      </Suspense>

      <Suspense fallback={null}>
        <TopByScore />
      </Suspense>

      <Suspense fallback={null}>
        <TopGrowers />
      </Suspense>

      <Suspense fallback={null}>
        <ForecastAccelerators />
      </Suspense>

      {history.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            最近見た銘柄
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {history.map((h) => (
              <Link
                key={h.code}
                href={`/stocks/${h.code}`}
                className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 px-4 py-2.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    <span className="font-mono text-neutral-500 mr-2">
                      {h.stock.ticker}
                    </span>
                    {h.stock.name}
                  </div>
                </div>
                <span className="text-neutral-400 shrink-0">→</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {watch.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              ⭐ ウォッチリスト
            </h2>
            <Link
              href="/watchlist"
              className="text-xs text-neutral-500 hover:underline"
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

      {history.length === 0 && watch.length === 0 && stockCount > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            👋 まずはサンプル銘柄で試す
          </h2>
          <div className="grid sm:grid-cols-3 gap-2">
            {EXAMPLE_STOCKS.map((s) => (
              <Link
                key={s.code}
                href={`/stocks/${s.code}`}
                className="rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 px-4 py-3 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition"
              >
                <div className="font-medium">{s.name}</div>
                <div className="text-xs text-neutral-500 mt-0.5">{s.note}</div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
