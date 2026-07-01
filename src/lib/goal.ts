// Goal math: 300万円 → 5000万円 / 5年 progress tracking.
import { prisma } from "./db";

export type GoalConfig = {
  targetAmount: number;
  startAmount: number;
  startDate: string; // ISO date (YYYY-MM-DD)
  years: number;
};

const DEFAULT_GOAL: GoalConfig = {
  targetAmount: 50_000_000,
  startAmount: 3_000_000,
  startDate: "2026-07-01",
  years: 5,
};

export async function getGoalConfig(): Promise<GoalConfig> {
  const rows = await prisma.appSetting.findMany({
    where: {
      key: { in: ["goalTarget", "goalStart", "goalStartDate", "goalYears"] },
    },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    targetAmount: Number(map.get("goalTarget") ?? DEFAULT_GOAL.targetAmount),
    startAmount: Number(map.get("goalStart") ?? DEFAULT_GOAL.startAmount),
    startDate: map.get("goalStartDate") ?? DEFAULT_GOAL.startDate,
    years: Number(map.get("goalYears") ?? DEFAULT_GOAL.years),
  };
}

export async function getCashBalance(): Promise<number> {
  const row = await prisma.appSetting.findUnique({
    where: { key: "cashBalance" },
  });
  return row ? Number(row.value) : 0;
}

// Required compound annual growth rate to hit the target exactly on schedule.
export function requiredCAGR(cfg: GoalConfig): number {
  return Math.pow(cfg.targetAmount / cfg.startAmount, 1 / cfg.years) - 1;
}

// What the balance "should" be at this point in time if compounding smoothly
// at the required CAGR — the pace line to compare actual net worth against.
export function expectedAmountAtDate(cfg: GoalConfig, now: Date): number {
  const start = new Date(cfg.startDate).getTime();
  const elapsedYears = Math.max(0, (now.getTime() - start) / (365.25 * 86400 * 1000));
  const cagr = requiredCAGR(cfg);
  return cfg.startAmount * Math.pow(1 + cagr, Math.min(elapsedYears, cfg.years));
}

export function progressPct(cfg: GoalConfig, currentAmount: number): number {
  return Math.max(
    0,
    Math.min(
      100,
      ((currentAmount - cfg.startAmount) / (cfg.targetAmount - cfg.startAmount)) * 100,
    ),
  );
}
