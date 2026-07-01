import { prisma } from "@/lib/db";
import { fetchYahoo } from "@/lib/yahoo-finance";
import {
  getGoalConfig,
  getCashBalance,
  requiredCAGR,
  expectedAmountAtDate,
  progressPct,
} from "@/lib/goal";
import Link from "next/link";

export async function GoalTracker() {
  const [openPositions, cash, goal] = await Promise.all([
    prisma.position.findMany({ where: { status: "open" } }),
    getCashBalance(),
    getGoalConfig(),
  ]);

  if (openPositions.length === 0 && cash === 0) return null;

  const positionValues = await Promise.all(
    openPositions.map(async (p) => {
      const q = await fetchYahoo(p.code, "1mo", 300).catch(() => null);
      const price = q?.regularMarketPrice ?? p.entryPrice;
      return price * p.shares;
    }),
  );
  const totalPositionValue = positionValues.reduce((s, v) => s + v, 0);
  const netWorth = totalPositionValue + cash;

  const cagr = requiredCAGR(goal);
  const now = new Date();
  const expected = expectedAmountAtDate(goal, now);
  const pct = progressPct(goal, netWorth);
  const onPace = netWorth >= expected;
  const startDate = new Date(goal.startDate);
  const elapsedDays = Math.max(
    0,
    (now.getTime() - startDate.getTime()) / 86400000,
  );
  const remainingDays = Math.max(0, goal.years * 365.25 - elapsedDays);

  return (
    <section className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-5 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          🎯 目標: {(goal.startAmount / 10000).toLocaleString()}万円 →{" "}
          {(goal.targetAmount / 10000).toLocaleString()}万円 / {goal.years}年
        </h2>
        <Link href="/positions" className="text-xs text-neutral-500 hover:underline">
          ポジション管理 →
        </Link>
      </div>

      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-2xl font-bold tabular-nums">
          {Math.round(netWorth).toLocaleString()}円
        </span>
        <span className="text-xs text-neutral-500">
          必要年利 {(cagr * 100).toFixed(1)}% ・ 残り約{Math.round(remainingDays / 30.44)}ヶ月
        </span>
      </div>

      <div className="w-full h-3 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden relative">
        <div
          className={`h-full rounded-full ${onPace ? "bg-emerald-500" : "bg-amber-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div
        className={`text-xs ${
          onPace
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-amber-600 dark:text-amber-400"
        }`}
      >
        {onPace ? "✓" : "⚠"} 現時点の目標ペース {Math.round(expected).toLocaleString()}円に対して
        {onPace ? "順調です" : `${Math.round(expected - netWorth).toLocaleString()}円 遅れています`}
      </div>
    </section>
  );
}
