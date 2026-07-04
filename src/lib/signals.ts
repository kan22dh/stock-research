// Daily signal generation, run by the morning cron AFTER a momentum snapshot
// is taken and BEFORE/AFTER refresh (see /api/daily-refresh):
//
//   pivot_breakout — a stock that was in a VCP setup (per yesterday's data)
//                    now trades above its pivot: the entry trigger fired.
//   vcp_new        — a stock newly entered VCP setup: goes on the watch list.
//   stop_raise     — an open position has advanced ≥10% from entry; suggest
//                    lifting the stop to price×0.92 (never lower it).
//
// Signals are stored idempotently per (date, type, code) so re-runs are safe.

import { prisma } from "./db";

export type MomentumSnapshot = Map<
  string,
  { vcpPass: boolean; pivot: number | null }
>;

export async function takeMomentumSnapshot(): Promise<MomentumSnapshot> {
  const rows = await prisma.momentum.findMany({
    select: { code: true, vcpPass: true, pivot: true },
  });
  return new Map(rows.map((r) => [r.code, { vcpPass: r.vcpPass, pivot: r.pivot }]));
}

// JST calendar date, regardless of server timezone.
export function jstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function computeDailySignals(
  snapshot: MomentumSnapshot,
  date = jstToday(),
): Promise<{ breakouts: number; newSetups: number; stopRaises: number }> {
  const fresh = await prisma.momentum.findMany({
    select: { code: true, vcpPass: true, pivot: true, price: true },
  });

  type Row = { date: string; type: string; code: string; payload: string };
  const rows: Row[] = [];

  for (const m of fresh) {
    const prev = snapshot.get(m.code);
    // Breakout: was a VCP setup, and current price now exceeds that pivot.
    if (
      prev?.vcpPass &&
      prev.pivot != null &&
      m.price != null &&
      m.price > prev.pivot
    ) {
      rows.push({
        date,
        type: "pivot_breakout",
        code: m.code,
        payload: JSON.stringify({
          pivot: prev.pivot,
          price: m.price,
          movePct: ((m.price - prev.pivot) / prev.pivot) * 100,
        }),
      });
      continue; // a breakout supersedes "still in setup"
    }
    // Newly formed setup: not a setup yesterday, is one now.
    if (m.vcpPass && prev && !prev.vcpPass) {
      rows.push({
        date,
        type: "vcp_new",
        code: m.code,
        payload: JSON.stringify({ pivot: m.pivot, price: m.price }),
      });
    }
  }

  // Stop-raise suggestions for open positions.
  const positions = await prisma.position.findMany({
    where: { status: "open" },
    include: { stock: { include: { momentum: true } } },
  });
  for (const p of positions) {
    const price = p.stock.momentum?.price ?? null;
    if (price == null) continue;
    const gainPct = ((price - p.entryPrice) / p.entryPrice) * 100;
    const suggested = Math.round(price * 0.92 * 10) / 10;
    if (gainPct >= 10 && (p.stopLossPrice == null || suggested > p.stopLossPrice)) {
      rows.push({
        date,
        type: "stop_raise",
        code: p.code,
        payload: JSON.stringify({
          positionId: p.id,
          price,
          gainPct,
          currentStop: p.stopLossPrice,
          suggestedStop: suggested,
        }),
      });
    }
  }

  if (rows.length > 0) {
    await prisma.signal.createMany({ data: rows, skipDuplicates: true });
  }
  return {
    breakouts: rows.filter((r) => r.type === "pivot_breakout").length,
    newSetups: rows.filter((r) => r.type === "vcp_new").length,
    stopRaises: rows.filter((r) => r.type === "stop_raise").length,
  };
}
