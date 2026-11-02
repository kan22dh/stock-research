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

// Weekdays in [start, end) — the denominator for coverage.
function weekdaysIn(start: string, end: string): number {
  let n = 0;
  for (let d = new Date(`${start}T00:00:00Z`); d < new Date(`${end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

// A month with fewer marked days than this is reported as a data gap, not
// as a return. (A normal month has ~21 weekdays.)
export const MIN_COVERAGE_DAYS = 10;
// The gap verdict also depends on the account start date, so the UI reads it
// from the note rather than re-deriving it from coverageDays.
export const GAP_MARK = "⚠ データ欠損";
export const isGapReview = (note: string) => note.includes(GAP_MARK);

// Called from paper-autopilot.ts right before starting the rebalance for
// `currentMonth`. Reviews EVERY closed month since the last review, not just
// the one before currentMonth — a cron outage that skips a whole month must
// not silently drop the month before it (2026-08 was never reviewed for that
// reason). Existing rows are left alone.
export async function computeMonthlyReview(currentMonth: string): Promise<void> {
  const firstEquity = await prisma.paperEquity.findFirst({ orderBy: { date: "asc" }, select: { date: true } });
  if (!firstEquity) return;
  const months: string[] = [];
  for (let m = firstEquity.date.slice(0, 7); m < currentMonth; m = nextMonth(m)) months.push(m);
  for (const m of months) await reviewMonth(m, firstEquity.date);
}

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

async function reviewMonth(reviewMonth: string, accountStart: string): Promise<void> {
  const existing = await prisma.paperReview.findUnique({ where: { month: reviewMonth } });
  if (existing) return;

  const { start, end } = monthBounds(reviewMonth);
  const [equityStart, equityEnd, benchStart, benchEnd, coverageDays] = await Promise.all([
    equityAt(start).then((v) => v ?? 600_000), // no prior data → assume start-of-account
    equityAt(end),
    benchmarkValueAt(start),
    benchmarkValueAt(end),
    prisma.paperEquity.count({ where: { date: { gte: start, lt: end } } }),
  ]);
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

  const lines: string[] = [];
  // The opening month only counts from the account's first day.
  const from = accountStart > start ? accountStart : start;
  const weekdays = weekdaysIn(from, end);
  const isGap = coverageDays < Math.min(MIN_COVERAGE_DAYS, Math.ceil(weekdays * 0.5));
  if (from !== start) lines.push(`開設月(${accountStart}開始)。`);
  if (isGap) {
    lines.push(
      `${GAP_MARK}: この月は評価記録が${coverageDays}/${weekdays}営業日しかありません(自動更新の停止)。数値は成績として扱えません。`,
    );
  } else {
    const diff = returnPct - benchReturnPct;
    lines.push(
      diff >= 0
        ? `TOPIXを${diff.toFixed(1)}pt上回りました。`
        : `TOPIXに${Math.abs(diff).toFixed(1)}pt劣後しました。`,
    );
  }
  if (trades.length > 0) {
    lines.push(
      `決済${trades.length}件・勝率${((wins.length / trades.length) * 100).toFixed(0)}%・純損益${Math.round(netPnlYen).toLocaleString()}円。`,
    );
  } else {
    lines.push("この月は決済(銘柄入替による売却)がありませんでした。");
  }

  // Sustained-underperformance flag over the last 3 MEASURED months (gap
  // months are skipped, not counted as either outcome).
  const recent = (
    await prisma.paperReview.findMany({
      where: { month: { lt: reviewMonth } },
      orderBy: { month: "desc" },
      select: { returnPct: true, benchReturnPct: true, note: true },
    })
  )
    .filter((r) => !isGapReview(r.note))
    .slice(0, 2);
  const allRecentUnderperform =
    !isGap &&
    returnPct < benchReturnPct &&
    recent.length === 2 &&
    recent.every((r) => r.returnPct < r.benchReturnPct);
  if (allRecentUnderperform) {
    lines.push(
      "🚩 計測できた直近3ヶ月すべてで指数に劣後しています。/backtestで前提が今も成立しているか確認することを推奨します(自動での戦略変更は行いません)。",
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
      coverageDays,
    },
  });
}
