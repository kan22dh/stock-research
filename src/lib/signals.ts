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
import { computeRSRatings } from "./momentum";

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
    select: { code: true, vcpPass: true, pivot: true, price: true, rsRaw: true, technicalPass: true },
  });
  // RS Rating is universe-relative, so percentile-rank the whole snapshot once.
  const rsRatings = computeRSRatings(fresh);

  type Row = { date: string; type: string; code: string; payload: string };
  const rows: Row[] = [];
  type BreakoutMeta = { rs: number | null; tt: boolean };
  const breakoutMeta = new Map<string, BreakoutMeta>();

  for (const m of fresh) {
    const prev = snapshot.get(m.code);
    // Breakout: was a VCP setup, and current price now exceeds that pivot.
    if (
      prev?.vcpPass &&
      prev.pivot != null &&
      m.price != null &&
      m.price > prev.pivot
    ) {
      breakoutMeta.set(m.code, {
        rs: rsRatings.get(m.code) ?? null,
        tt: m.technicalPass,
      });
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

  // Freeze the three verified buy-gate criteria (RS>=70 / Trend Template /
  // sales YoY >=10%) into each breakout's payload AS OF signal time, so the
  // /signals track record can split "rule-pass" vs "rule-fail" outcomes
  // without hindsight bias. salesYoY comes from the latest cached FY — the
  // J-Quants free plan lags ~12 weeks, hence `fy` is stored so the UI can
  // tell the reader which fiscal year the number belongs to.
  const breakoutCodes = [...breakoutMeta.keys()];
  if (breakoutCodes.length > 0) {
    const fins = await prisma.financialCache.findMany({
      where: { code: { in: breakoutCodes } },
      orderBy: { fiscalYearEnd: "desc" },
      select: { code: true, fiscalYearEnd: true, salesYoY: true },
    });
    const latestFin = new Map<string, { fiscalYearEnd: string; salesYoY: number | null }>();
    for (const f of fins) if (!latestFin.has(f.code)) latestFin.set(f.code, f);
    for (const r of rows) {
      if (r.type !== "pivot_breakout") continue;
      const meta = breakoutMeta.get(r.code);
      const fin = latestFin.get(r.code);
      const rs = meta?.rs ?? null;
      const tt = meta?.tt ?? false;
      const salesYoY = fin?.salesYoY ?? null;
      const gate = rs != null && rs >= 70 && tt && salesYoY != null && salesYoY >= 10;
      r.payload = JSON.stringify({
        ...JSON.parse(r.payload),
        rs,
        tt,
        salesYoY,
        fy: fin?.fiscalYearEnd ?? null,
        gate,
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
