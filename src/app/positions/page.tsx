import { prisma } from "@/lib/db";
import { fetchYahoo } from "@/lib/yahoo-finance";
import {
  createPosition,
  closePosition,
  updateStopLoss,
  updateCashBalance,
} from "@/app/actions/positions";
import { getGoalConfig, getCashBalance, requiredCAGR } from "@/lib/goal";
import Link from "next/link";

// force-dynamic, not ISR — see system-health-badge.tsx for why (2026-07 incident)
export const dynamic = "force-dynamic";

export default async function PositionsPage() {
  const [openPositions, closedPositions, cash, goal] = await Promise.all([
    prisma.position.findMany({
      where: { status: "open" },
      include: { stock: true, journal: true },
      orderBy: { entryDate: "desc" },
    }),
    prisma.position.findMany({
      where: { status: "closed" },
      include: { stock: true, journal: true },
      orderBy: { closeDate: "desc" },
      take: 30,
    }),
    getCashBalance(),
    getGoalConfig(),
  ]);

  const withLive = await Promise.all(
    openPositions.map(async (p) => {
      const q = await fetchYahoo(p.code, "1mo", 300).catch(() => null);
      const price = q?.regularMarketPrice ?? p.entryPrice;
      const value = price * p.shares;
      const cost = p.entryPrice * p.shares;
      const pnlPct = ((price - p.entryPrice) / p.entryPrice) * 100;
      const stopDistancePct = p.stopLossPrice
        ? ((price - p.stopLossPrice) / price) * 100
        : null;
      return { ...p, livePrice: price, value, cost, pnlPct, stopDistancePct };
    }),
  );

  const totalPositionValue = withLive.reduce((s, p) => s + p.value, 0);
  const totalCost = withLive.reduce((s, p) => s + p.cost, 0);
  const netWorth = totalPositionValue + cash;
  const cagr = requiredCAGR(goal);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">保有ポジション</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
          実際の保有株数・取得単価・損切りラインを記録し、規律を可視化します。ウォッチリストとは別管理です。
        </p>
      </header>

      <section className="grid sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-4">
          <div className="text-xs text-neutral-500">保有評価額</div>
          <div className="text-xl font-bold tabular-nums mt-1">
            {Math.round(totalPositionValue).toLocaleString()}円
          </div>
          <div
            className={`text-xs mt-0.5 tabular-nums ${
              totalPositionValue >= totalCost
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            取得原価 {Math.round(totalCost).toLocaleString()}円 (
            {totalCost > 0
              ? (((totalPositionValue - totalCost) / totalCost) * 100).toFixed(1)
              : "0.0"}
            %)
          </div>
        </div>
        <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-4">
          <div className="text-xs text-neutral-500">現金残高</div>
          <form
            action={async (fd) => {
              "use server";
              await updateCashBalance(fd);
            }}
            className="flex items-center gap-2 mt-1"
          >
            <input
              type="number"
              name="cashBalance"
              defaultValue={cash}
              step="1000"
              className="w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-2 py-1 text-sm tabular-nums"
            />
            <button
              type="submit"
              className="rounded-lg border border-black/15 dark:border-white/15 px-2 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 shrink-0"
            >
              更新
            </button>
          </form>
        </div>
        <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-4">
          <div className="text-xs text-neutral-500">総資産(目標に対する進捗)</div>
          <div className="text-xl font-bold tabular-nums mt-1">
            {Math.round(netWorth).toLocaleString()}円
          </div>
          <div className="text-xs text-neutral-500 mt-0.5">
            目標 {goal.targetAmount.toLocaleString()}円 / 必要年利
            {(cagr * 100).toFixed(1)}%
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-5">
        <h2 className="text-sm font-semibold mb-3">➕ ポジション追加</h2>
        <form
          action={async (fd) => {
            "use server";
            await createPosition(fd);
          }}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          <div>
            <label className="block text-xs font-medium mb-1 text-neutral-600 dark:text-neutral-400">
              銘柄コード(5桁, 例: 94320)
            </label>
            <input
              name="code"
              required
              className="w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-neutral-600 dark:text-neutral-400">
              株数
            </label>
            <input
              type="number"
              name="shares"
              step="1"
              required
              className="w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-neutral-600 dark:text-neutral-400">
              取得単価
            </label>
            <input
              type="number"
              name="entryPrice"
              step="0.1"
              required
              className="w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-neutral-600 dark:text-neutral-400">
              取得日
            </label>
            <input
              type="date"
              name="entryDate"
              className="w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-neutral-600 dark:text-neutral-400">
              損切りライン(推奨: 取得単価-8%)
            </label>
            <input
              type="number"
              name="stopLossPrice"
              step="0.1"
              className="w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-neutral-600 dark:text-neutral-400">
              目標株価(任意)
            </label>
            <input
              type="number"
              name="targetPrice"
              step="0.1"
              className="w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm tabular-nums"
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className="block text-xs font-medium mb-1 text-neutral-600 dark:text-neutral-400">
              購入理由・仮説(ジャーナル、任意だが推奨)
            </label>
            <textarea
              name="thesis"
              rows={2}
              placeholder="例: 業績加速+Trend Template通過。崩れる条件: 売上YoYが2四半期連続鈍化"
              className="w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm"
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <button
              type="submit"
              className="rounded-lg bg-neutral-900 dark:bg-white px-4 py-1.5 text-white dark:text-neutral-900 text-sm font-medium hover:opacity-90 transition"
            >
              追加
            </button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-3">保有中 ({withLive.length}件)</h2>
        {withLive.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-neutral-500">
            保有ポジションがありません。上のフォームで追加してください。
          </div>
        ) : (
          <div className="space-y-3">
            {withLive.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-4 space-y-3"
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <Link href={`/stocks/${p.code}`} className="font-medium hover:underline">
                    <span className="font-mono text-neutral-500 mr-2">{p.stock.ticker}</span>
                    {p.stock.name}
                  </Link>
                  <div
                    className={`text-lg font-bold tabular-nums ${
                      p.pnlPct >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {p.pnlPct >= 0 ? "+" : ""}
                    {p.pnlPct.toFixed(1)}%
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div>
                    <div className="text-neutral-500">株数</div>
                    <div className="tabular-nums font-medium">{p.shares.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-neutral-500">取得単価</div>
                    <div className="tabular-nums font-medium">¥{p.entryPrice.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-neutral-500">現在値</div>
                    <div className="tabular-nums font-medium">¥{p.livePrice.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-neutral-500">評価額</div>
                    <div className="tabular-nums font-medium">
                      {Math.round(p.value).toLocaleString()}円
                    </div>
                  </div>
                </div>
                {p.stopLossPrice != null && (
                  <div
                    className={`text-xs rounded-lg px-3 py-2 ${
                      p.stopDistancePct != null && p.stopDistancePct < 3
                        ? "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400"
                        : "bg-neutral-50 dark:bg-neutral-800/50 text-neutral-600 dark:text-neutral-400"
                    }`}
                  >
                    🛑 損切りライン ¥{p.stopLossPrice.toLocaleString()}
                    {p.stopDistancePct != null &&
                      ` (現在値まで${p.stopDistancePct.toFixed(1)}%)`}
                  </div>
                )}
                {p.journal.length > 0 && (
                  <div className="text-xs text-neutral-500 border-t border-black/5 dark:border-white/5 pt-2">
                    📝 {p.journal[0].reason}
                  </div>
                )}
                <details className="text-xs">
                  <summary className="cursor-pointer text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
                    損切り更新 / 決済
                  </summary>
                  <div className="mt-2 space-y-2">
                    <form
                      action={async (fd) => {
                        "use server";
                        await updateStopLoss(fd);
                      }}
                      className="flex items-center gap-2"
                    >
                      <input type="hidden" name="id" value={p.id} />
                      <input
                        type="number"
                        name="stopLossPrice"
                        step="0.1"
                        placeholder="新しい損切り価格"
                        defaultValue={p.stopLossPrice ?? ""}
                        className="rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-2 py-1 text-xs tabular-nums"
                      />
                      <button className="rounded-lg border border-black/15 dark:border-white/15 px-2 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800">
                        損切り更新
                      </button>
                    </form>
                    <form
                      action={async (fd) => {
                        "use server";
                        await closePosition(fd);
                      }}
                      className="flex items-center gap-2 flex-wrap"
                    >
                      <input type="hidden" name="id" value={p.id} />
                      <input
                        type="number"
                        name="closePrice"
                        step="0.1"
                        placeholder="決済価格"
                        required
                        className="rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-2 py-1 text-xs tabular-nums w-28"
                      />
                      <input
                        type="text"
                        name="reason"
                        placeholder="決済理由(必須)"
                        required
                        className="rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-2 py-1 text-xs flex-1 min-w-[10rem]"
                      />
                      <button className="rounded-lg bg-red-600 px-3 py-1 text-xs text-white hover:opacity-90">
                        決済(クローズ)
                      </button>
                    </form>
                  </div>
                </details>
              </div>
            ))}
          </div>
        )}
      </section>

      {closedPositions.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-3">
            売買ジャーナル(決済済み {closedPositions.length}件)
          </h2>
          <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 divide-y divide-black/5 dark:divide-white/5 overflow-hidden">
            {closedPositions.map((p) => {
              const pnlPct =
                p.closePrice != null
                  ? ((p.closePrice - p.entryPrice) / p.entryPrice) * 100
                  : null;
              return (
                <div key={p.id} className="px-4 py-3 text-sm">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <Link href={`/stocks/${p.code}`} className="font-medium hover:underline">
                      <span className="font-mono text-neutral-500 mr-2">{p.stock.ticker}</span>
                      {p.stock.name}
                    </Link>
                    {pnlPct != null && (
                      <span
                        className={`font-bold tabular-nums ${
                          pnlPct >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {pnlPct >= 0 ? "+" : ""}
                        {pnlPct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-neutral-500 mt-1">
                    ¥{p.entryPrice} → ¥{p.closePrice} ・{" "}
                    {p.closeDate?.toISOString().slice(0, 10)}
                  </div>
                  {p.journal.map((j) => (
                    <div key={j.id} className="text-xs text-neutral-600 dark:text-neutral-400 mt-1">
                      {j.type === "buy" ? "🟢" : j.type === "sell" ? "🔴" : "📝"} {j.reason}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
