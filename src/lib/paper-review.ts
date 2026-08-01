// Automatic monthly reflection for the paper autopilot — computed by the
// system itself right before each new rebalance, not by a human remembering
// to run /勝者運用 月次. The point is to guarantee the record exists, not to
// let it change the strategy automatically.
//
// Deliberately does NOT feed back into paper-autopilot.ts's rules. A few
// months of live paper-trade noise is not a valid basis to retune a
// strategy validated on a 10-year backtest (RESEARCH_WINNING_SYSTEMS.md
// §7-§9) — that would be overfitting to recent noise, exactly the mistake
// this whole system is designed to avoid. What this DOES do: surface facts
// (this month's return vs benchmark, trade stats) and raise a flag after
// sustained underperformance so a human decides whether to re-run the
// backtest suite — not so the code decides to mutate itself.

import { prisma } from "./db";

const BENCHMARK_CODE = "13060";

function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { start, end: `${nextMonth}-01` };
}

function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

async function equityAt(dateExclusiveUpperBound: string): Promise<number | null> {
  const row = await prisma.paperEquity.findFirst({
    where: { date: { lt: dateExclusiveUpperBound } },
    orderBy: { date: "desc" },
    select: { equity: true },
  });
  return row?.equity ?? null;
}

async function benchmarkValueAt(dateExclusiveUpperBound: string): Promise<number | null> {
  const row = await prisma.priceCache.findFirst({
    where: { code: BENCHMARK_CODE, date: { lt: new Date(dateExclusiveUpperBound) } },
    orderBy: { date: "desc" },
    select: { close: true, adjClose: true },
  });
  return row ? (row.adjClose ?? row.close) : null;
}

// Called from paper-autopilot.ts right before starting the rebalance for
// `currentMonth` — reviews the month that just ended (currentMonth's
// predecessor). No-ops (and doesn't overwrite) if already computed.
export async function computeMonthlyReview(currentMonth: string): Promise<void> {
  const reviewMonth = prevMonth(currentMonth);
  const existing = await prisma.paperReview.findUnique({ where: { month: reviewMonth } });
  if (existing) return;

  const { start, end } = monthBounds(reviewMonth);
  const [equityStart, equityEnd, benchStart, benchEnd] = await Promise.all([
    equityAt(start).then((v) => v ?? 600_000), // no prior data → assume start-of-account
    equityAt(end),
    benchmarkValueAt(start),
    benchmarkValueAt(end),
  ]);
  // Nothing to review yet (e.g. very first month, cron gap) — skip silently,
  // this isn't a failure, just insufficient history for that month.
  if (equityEnd == null || benchStart == null || benchEnd == null) return;

  const returnPct = (equityEnd / equityStart - 1) * 100;
  const benchReturnPct = (benchEnd / benchStart - 1) * 100;

  const trades = await prisma.paperTrade.findMany({
    where: { side: "sell", date: { gte: start, lt: end }, pnl: { not: null } },
    select: { pnl: true },
  });
  const pnls = trades.map((t) => t.pnl!);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p <= 0);
  const avgWinYen = wins.length > 0 ? wins.reduce((s, v) => s + v, 0) / wins.length : null;
  const avgLossYen =
    losses.length > 0 ? losses.reduce((s, v) => s + v, 0) / losses.length : null;
  const netPnlYen = pnls.reduce((s, v) => s + v, 0);

  const diff = returnPct - benchReturnPct;
  const lines: string[] = [];
  lines.push(
    diff >= 0
      ? `TOPIXを${diff.toFixed(1)}pt上回りました。`
      : `TOPIXに${Math.abs(diff).toFixed(1)}pt劣後しました。`,
  );
  if (trades.length > 0) {
    lines.push(
      `決済${trades.length}件・勝率${((wins.length / trades.length) * 100).toFixed(0)}%・純損益${Math.round(netPnlYen).toLocaleString()}円。`,
    );
  } else {
    lines.push("この月は決済(銘柄入替による売却)がありませんでした。");
  }

  // Sustained-underperformance flag: last 2 reviews + this one all negative
  // diff → surface for human attention, don't auto-act.
  const recent = await prisma.paperReview.findMany({
    orderBy: { month: "desc" },
    take: 2,
    select: { returnPct: true, benchReturnPct: true },
  });
  const allRecentUnderperform =
    diff < 0 && recent.length === 2 && recent.every((r) => r.returnPct < r.benchReturnPct);
  if (allRecentUnderperform) {
    lines.push(
      "🚩 3ヶ月連続で指数に劣後しています。/backtestで前提が今も成立しているか確認することを推奨します(自動での戦略変更は行いません)。",
    );
  }

  await prisma.paperReview.create({
    data: {
      month: reviewMonth,
      returnPct,
      benchReturnPct,
      tradesClosed: trades.length,
      wins: wins.length,
      avgWinYen,
      avgLossYen,
      netPnlYen,
      note: lines.join(""),
    },
  });
}
