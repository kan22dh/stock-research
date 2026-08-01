// Objective withdrawal/circuit-breaker rule for the paper autopilot,
// grounded in the strategy's OWN 10-year backtested worst-case history
// (scripts/rolling-worst-analysis.ts, 2017-08〜2026-07, 107 months of
// RS-top10 + Trend Template vs TOPIX ETF):
//
//   worst rolling 12-month excess return (strategy - benchmark): -34.5%
//   worst rolling 24-month excess return:                        -43.8%
//   worst monthly-close max drawdown:                            -40.5%
//
// Thresholds below add a margin beyond each historical worst so that a
// merely-bad-but-historically-normal patch (which WILL happen — this is a
// 44%-monthly-win-rate strategy) does NOT trigger. A breach means live
// performance is outside anything this exact strategy has done in 10 years
// of real market history, including the 2022 bear market and 2023's rough
// stretch — i.e. something structurally different, not garden-variety bad
// luck the backtest already accounts for.
//
// This is a HARD STOP proposal, not a silent auto-liquidation: it raises a
// Signal + a loud banner. A human decides what "stop" means (halt new
// buys? liquidate? redesign?) — see RESEARCH_WINNING_SYSTEMS.md for how
// strategy changes get validated (backtest first, always).

import { prisma } from "./db";

export const WITHDRAWAL_THRESHOLDS = {
  maxDrawdownPct: -45, // worst backtested was -40.5%
  rolling12mExcessPct: -40, // worst backtested was -34.5%
  rolling24mExcessPct: -50, // worst backtested was -43.8%
};

const BENCHMARK_CODE = "13060";

async function benchmarkValueAt(date: string): Promise<number | null> {
  const row = await prisma.priceCache.findFirst({
    where: { code: BENCHMARK_CODE, date: { lte: new Date(date) } },
    orderBy: { date: "desc" },
    select: { close: true, adjClose: true },
  });
  return row ? (row.adjClose ?? row.close) : null;
}

export type WithdrawalCheck = {
  triggered: boolean;
  reasons: string[];
  currentDrawdownPct: number | null;
  rolling12mExcessPct: number | null;
  rolling24mExcessPct: number | null;
};

export async function checkWithdrawalTriggers(): Promise<WithdrawalCheck> {
  const equity = await prisma.paperEquity.findMany({ orderBy: { date: "asc" } });
  const reasons: string[] = [];

  // 1) Drawdown from peak — works from day 1, no history requirement.
  let peak = -Infinity;
  let maxDD = 0;
  for (const e of equity) {
    peak = Math.max(peak, e.equity);
    maxDD = Math.min(maxDD, e.equity / peak - 1);
  }
  const currentDrawdownPct = equity.length > 0 ? maxDD * 100 : null;
  if (currentDrawdownPct != null && currentDrawdownPct <= WITHDRAWAL_THRESHOLDS.maxDrawdownPct) {
    reasons.push(
      `最大ドローダウン${currentDrawdownPct.toFixed(1)}%が過去10年の最悪(-40.5%)を超えました`,
    );
  }

  // 2) Rolling 12m / 24m excess vs benchmark — needs that much real history.
  const first = equity[0];
  const last = equity[equity.length - 1];
  let rolling12mExcessPct: number | null = null;
  let rolling24mExcessPct: number | null = null;

  if (first && last) {
    const daysSpan = (new Date(last.date).getTime() - new Date(first.date).getTime()) / 86_400_000;
    const check = async (months: number): Promise<number | null> => {
      if (daysSpan < months * 30) return null; // not enough live history yet
      const targetDate = new Date(last.date);
      targetDate.setMonth(targetDate.getMonth() - months);
      const targetStr = targetDate.toISOString().slice(0, 10);
      const past = equity.filter((e) => e.date <= targetStr).at(-1);
      if (!past) return null;
      const [bPast, bNow] = await Promise.all([
        benchmarkValueAt(past.date),
        benchmarkValueAt(last.date),
      ]);
      if (bPast == null || bNow == null) return null;
      const stratRet = last.equity / past.equity - 1;
      const benchRet = bNow / bPast - 1;
      return (stratRet - benchRet) * 100;
    };
    rolling12mExcessPct = await check(12);
    rolling24mExcessPct = await check(24);
  }

  if (
    rolling12mExcessPct != null &&
    rolling12mExcessPct <= WITHDRAWAL_THRESHOLDS.rolling12mExcessPct
  ) {
    reasons.push(
      `直近12ヶ月の対TOPIX超過${rolling12mExcessPct.toFixed(1)}ptが過去10年の最悪(-34.5pt)を超えました`,
    );
  }
  if (
    rolling24mExcessPct != null &&
    rolling24mExcessPct <= WITHDRAWAL_THRESHOLDS.rolling24mExcessPct
  ) {
    reasons.push(
      `直近24ヶ月の対TOPIX超過${rolling24mExcessPct.toFixed(1)}ptが過去10年の最悪(-43.8pt)を超えました`,
    );
  }

  return {
    triggered: reasons.length > 0,
    reasons,
    currentDrawdownPct,
    rolling12mExcessPct,
    rolling24mExcessPct,
  };
}
