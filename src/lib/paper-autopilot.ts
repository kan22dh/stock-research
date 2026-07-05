// L3 paper autopilot: fully automated simulated trading, executed by the
// morning cron right after signal generation. This is the decision engine a
// future kabu-station-API bot (L5) will reuse — only execution differs.
//
// Rules (all validated or champion-sourced; see RESEARCH_WINNING_SYSTEMS.md):
//   Market filter (M): TOPIX ETF must be above its 50-day MA, else no buys.
//   Entry: today's pivot_breakout signals, best RS first, max 8 positions.
//   Sizing: risk 1% of equity per trade with an 8% stop → ~12.5% of equity,
//           capped by available cash.
//   Exit:  close at/below stop → sell all (stop was raised along the way:
//          at +10% from entry the stop trails to price×0.92, never lowered).
//
// Honest limitation: fills happen at the morning-observed price (previous
// close), one day after the breakout close — real fills will differ.

import { prisma } from "./db";
import { fetchYahoo } from "./yahoo-finance";
import { jstToday } from "./signals";

const START_CASH = 600_000; // mirrors the real active sleeve (NISA NTT is separate)
const MAX_POSITIONS = 8;
const RISK_PER_TRADE = 0.01; // 1% of equity
const STOP_PCT = 0.08;
const TRAIL_TRIGGER = 1.1; // +10% → start trailing
const TRAIL_FACTOR = 0.92; // stop = price × 0.92

async function getCash(): Promise<number> {
  const row = await prisma.appSetting.findUnique({ where: { key: "paperCash" } });
  if (row) return Number(row.value);
  await prisma.appSetting.create({
    data: { key: "paperCash", value: String(START_CASH) },
  });
  return START_CASH;
}

async function setCash(v: number): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: "paperCash" },
    create: { key: "paperCash", value: String(v) },
    update: { value: String(v) },
  });
}

// Market filter: TOPIX ETF above its 50-day MA (Yahoo live, ~3mo of bars).
async function marketFilterPass(): Promise<boolean> {
  const q = await fetchYahoo("13060", "6mo", 3600).catch(() => null);
  if (!q || q.bars.length < 50) return false; // fail-safe: no data → no buys
  const closes = q.bars.map((b) => b.adjClose ?? b.close);
  const ma50 = closes.slice(-50).reduce((s, v) => s + v, 0) / 50;
  const price = q.regularMarketPrice ?? closes[closes.length - 1];
  return price > ma50;
}

export type AutopilotResult = {
  date: string;
  sells: number;
  buys: number;
  skippedMarketFilter: boolean;
  equity: number;
  cash: number;
};

export async function runPaperAutopilot(): Promise<AutopilotResult> {
  const date = jstToday();
  let cash = await getCash();
  let sells = 0;
  let buys = 0;

  // Current prices come from the just-refreshed Momentum table.
  const positions = await prisma.paperPosition.findMany({
    include: { stock: { include: { momentum: true } } },
  });

  // 1) Exits + trailing-stop maintenance.
  for (const p of positions) {
    const price = p.stock.momentum?.price ?? null;
    if (price == null) continue;

    if (price <= p.stopPrice) {
      const proceeds = price * p.shares;
      const pnl = (price - p.entryPrice) * p.shares;
      cash += proceeds;
      await prisma.$transaction([
        prisma.paperTrade.create({
          data: {
            date,
            code: p.code,
            side: "sell",
            shares: p.shares,
            price,
            pnl,
            reason:
              price >= p.entryPrice
                ? `トレーリングストップ(¥${p.stopPrice})到達。利益確保`
                : `損切りライン(¥${p.stopPrice})到達。規律通り撤退`,
          },
        }),
        prisma.paperPosition.delete({ where: { id: p.id } }),
      ]);
      sells++;
      continue;
    }

    // Trail: once +10% from entry, keep stop at price×0.92 (never lower).
    const newHigh = Math.max(p.highWater, price);
    let newStop = p.stopPrice;
    if (newHigh >= p.entryPrice * TRAIL_TRIGGER) {
      newStop = Math.max(p.stopPrice, Math.round(newHigh * TRAIL_FACTOR * 10) / 10);
    }
    if (newHigh !== p.highWater || newStop !== p.stopPrice) {
      await prisma.paperPosition.update({
        where: { id: p.id },
        data: { highWater: newHigh, stopPrice: newStop },
      });
    }
  }

  // 2) Entries from today's breakout signals.
  const skippedMarketFilter = !(await marketFilterPass());
  if (!skippedMarketFilter) {
    const breakouts = await prisma.signal.findMany({
      where: { date, type: "pivot_breakout" },
      include: { stock: { include: { momentum: true } } },
    });
    // Highest RS raw first — strongest stocks get the slots.
    breakouts.sort(
      (a, b) => (b.stock.momentum?.rsRaw ?? 0) - (a.stock.momentum?.rsRaw ?? 0),
    );

    for (const sig of breakouts) {
      const openCount = await prisma.paperPosition.count();
      if (openCount >= MAX_POSITIONS) break;
      const price = sig.stock.momentum?.price ?? null;
      if (price == null || price <= 0) continue;
      const held = await prisma.paperPosition.findUnique({
        where: { code: sig.code },
      });
      if (held) continue;

      const posValue = await currentEquity(cash);
      const targetValue = Math.min((posValue * RISK_PER_TRADE) / STOP_PCT, cash);
      // S株(単元未満株)前提で1株単位。単元株(100株)縛りだと60万円の資金では
      // リスク1%規律とほぼ全銘柄が両立しない(1単元10万円超が大半)ため。
      // SBIのS株は売買手数料無料なのでコストモデルもそのまま成立する。
      const shares = Math.floor(targetValue / price);
      if (shares < 1) continue;
      const cost = shares * price;

      cash -= cost;
      await prisma.$transaction([
        prisma.paperTrade.create({
          data: {
            date,
            code: sig.code,
            side: "buy",
            shares,
            price,
            reason: `ピボット突破シグナル。損切り¥${Math.round(price * (1 - STOP_PCT) * 10) / 10}`,
          },
        }),
        prisma.paperPosition.create({
          data: {
            code: sig.code,
            shares,
            entryPrice: price,
            entryDate: date,
            stopPrice: Math.round(price * (1 - STOP_PCT) * 10) / 10,
            highWater: price,
          },
        }),
      ]);
      buys++;
    }
  }

  await setCash(cash);
  const equity = await currentEquity(cash);
  await prisma.paperEquity.upsert({
    where: { date },
    create: { date, equity, cash },
    update: { equity, cash },
  });

  return { date, sells, buys, skippedMarketFilter, equity, cash };
}

async function currentEquity(cash: number): Promise<number> {
  const positions = await prisma.paperPosition.findMany({
    include: { stock: { include: { momentum: true } } },
  });
  const posValue = positions.reduce(
    (s, p) => s + (p.stock.momentum?.price ?? p.entryPrice) * p.shares,
    0,
  );
  return cash + posValue;
}
