// Objective withdrawal/circuit-breaker rule for the paper autopilot,
// grounded in the strategy's OWN backtested worst-case history.
//
// Re-derived 2026-11 on REPAIRED data (scripts/research/rolling-worst.ts):
// the original 2026-07 figures (−40.5% / −34.5pt / −43.8pt) came from Yahoo
// series with unadjusted splits and a stitched listing (see lastBreakIndex in
// momentum.ts), and on clean data the strategy's own history already went
// past every old threshold. Worst cases, RS-top10 + Trend Template vs TOPIX:
//
//                                  2017-11→2026-10   2009-01→2026-10
//   max drawdown (month-end):           −45.9%            −52.0%
//   worst rolling 12m excess:           −33.8pt           −42.8pt
//   worst rolling 24m excess:           −50.4pt           −50.4pt
//
// Thresholds sit a few points beyond the LONGER history's worst, so a
// bad-but-historically-normal patch does NOT trigger. A breach means live
// performance is outside anything this strategy did in 17 years — something
// structurally different, not bad luck the backtest already contains.
//
// This is a HARD STOP proposal, not a silent auto-liquidation: it raises a
// Signal + a loud banner. A human decides what "stop" means (halt new
// buys? liquidate? redesign?) — see RESEARCH_WINNING_SYSTEMS.md for how
// strategy changes get validated (backtest first, always).

import { prisma } from "./db";

export const WITHDRAWAL_THRESHOLDS = {
  maxDrawdownPct: -55, // worst backtested (2009→, repaired) −52.0%
  rolling12mExcessPct: -45, // worst backtested −42.8pt
  rolling24mExcessPct: -55, // worst backtested −50.4pt
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
