// L3 paper autopilot — runs the ONLY strategy that survived validation:
// monthly rebalance into the top-10 stocks by RS raw momentum among Trend
// Template passers (+18.7%/yr vs TOPIX +13.4% over 10y, see
// RESEARCH_WINNING_SYSTEMS.md §7).
//
// Deliberately absent (each tested and found harmful mechanically, §7-§8):
//   - intra-month stop-losses (whipsaw: -8pt/yr)
//   - daily VCP-breakout entries (+4.5%/yr vs index +13.3% — big underperform)
//   - concentration below ~10 names (single-stock blowups dominate)
// VCP/breakout signals remain on the home feed for DISCRETIONARY (L2/L4) use;
// the mechanical account must not trade them.
//
// Cadence: the cron runs every weekday; this rebalances only on the first
// run of each calendar month and otherwise just marks equity.

import { prisma } from "./db";
import { jstToday } from "./signals";

const START_CASH = 600_000; // mirrors the real active sleeve
const TOP_N = 10;

async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

async function getCash(): Promise<number> {
  const v = await getSetting("paperCash");
  if (v != null) return Number(v);
  await setSetting("paperCash", String(START_CASH));
  return START_CASH;
}

export type AutopilotResult = {
  date: string;
  rebalanced: boolean;
  sells: number;
  buys: number;
  holdings: number;
  equity: number;
  cash: number;
};

export async function runPaperAutopilot(): Promise<AutopilotResult> {
  const date = jstToday();
  const month = date.slice(0, 7);
  let cash = await getCash();
  let sells = 0;
  let buys = 0;

  const positions = await prisma.paperPosition.findMany({
    include: { stock: { include: { momentum: true } } },
  });
  const priceOf = (p: (typeof positions)[number]): number =>
    p.stock.momentum?.price ?? p.entryPrice;

  const lastRebalance = await getSetting("paperLastRebalanceMonth");
  const rebalanced = lastRebalance !== month;

  if (rebalanced) {
    // Target: top-10 by rsRaw among Trend Template passers. Fewer than 10
    // qualify in bad markets → the rest stays in cash (the strategy's
    // built-in defensive mode, same as the validated backtest).
    const candidates = await prisma.momentum.findMany({
      where: { technicalPass: true, rsRaw: { not: null } },
      orderBy: { rsRaw: "desc" },
      take: TOP_N,
      select: { code: true, price: true },
    });
    const target = new Set(candidates.map((c) => c.code));

    // Sell whatever fell out of the target list.
    for (const p of positions) {
      if (target.has(p.code)) continue;
      const price = priceOf(p);
      const pnl = (price - p.entryPrice) * p.shares;
      cash += price * p.shares;
      await prisma.$transaction([
        prisma.paperTrade.create({
          data: {
            date,
            code: p.code,
            side: "sell",
            shares: p.shares,
            price,
            pnl,
            reason: "月次リバランス: RS上位10圏外へ後退",
          },
        }),
        prisma.paperPosition.delete({ where: { id: p.id } }),
      ]);
      sells++;
    }

    // Buy new entrants, equal-weighting the remaining cash across new slots.
    const heldCodes = new Set(
      (await prisma.paperPosition.findMany({ select: { code: true } })).map(
        (p) => p.code,
      ),
    );
    const entrants = candidates.filter(
      (c) => !heldCodes.has(c.code) && c.price != null && c.price > 0,
    );
    for (let k = 0; k < entrants.length; k++) {
      const c = entrants[k];
      const slotBudget = cash / (entrants.length - k); // spread cash evenly
      const shares = Math.floor(slotBudget / c.price!); // S株前提の1株単位
      if (shares < 1) continue;
      const cost = shares * c.price!;
      cash -= cost;
      await prisma.$transaction([
        prisma.paperTrade.create({
          data: {
            date,
            code: c.code,
            side: "buy",
            shares,
            price: c.price!,
            reason: "月次リバランス: RS上位10+Trend Template通過",
          },
        }),
        prisma.paperPosition.create({
          data: {
            code: c.code,
            shares,
            entryPrice: c.price!,
            entryDate: date,
            stopPrice: 0, // 検証済み戦略に月中損切りはない(§7: 機械的損切りは有害)
            highWater: c.price!,
          },
        }),
      ]);
      buys++;
    }

    await setSetting("paperLastRebalanceMonth", month);
    await setSetting("paperCash", String(cash));
  }

  // Mark daily equity.
  const finalPositions = await prisma.paperPosition.findMany({
    include: { stock: { include: { momentum: true } } },
  });
  const equity =
    cash +
    finalPositions.reduce(
      (s, p) => s + (p.stock.momentum?.price ?? p.entryPrice) * p.shares,
      0,
    );
  await prisma.paperEquity.upsert({
    where: { date },
    create: { date, equity, cash },
    update: { equity, cash },
  });

  return {
    date,
    rebalanced,
    sells,
    buys,
    holdings: finalPositions.length,
    equity,
    cash,
  };
}
