// v2「年間損失上限型」— pure logic shared by the research simulator
// (scripts/research/sim-guard.ts) and the live v2 paper account
// (src/lib/guard-account.ts), so the backtest and the live account cannot
// drift apart. Pre-registered in scripts/research/PREREGISTRATION.md
// (round 3, commit 53cfb63).
//
// Idea (CPPI / TIPP — Black & Perold 1992; Estep & Kritzman 1988): each
// January the year's floor is set to start × (1 − L). Only the cushion above
// the floor is put at risk: stock exposure = m × cushion. A falling market
// shrinks the cushion and so the exposure, which is what bounds the year's
// loss near −L. TIPP additionally ratchets the floor up behind the year's
// high-water mark, locking in gains. With cash at 0%, nothing can promise a
// non-negative year — the floor bounds the loss, it does not remove it, and an
// overnight gap can still push the year below −L.

export type GuardParams = {
  lossBudget: number; // L, e.g. 0.05
  multiplier: number; // m, e.g. 4
  floorType: "CPPI" | "TIPP";
  band: number; // resize only when |target − current| exposure > band (0.10)
};

export const DEFAULT_GUARD: GuardParams = { lossBudget: 0.05, multiplier: 4, floorType: "TIPP", band: 0.1 };

export type GuardYearState = {
  year: number;
  startValue: number;
  floor: number;
  hwm: number;
  locked: boolean; // V ≤ floor happened → all cash until year end
};

export function newYear(year: number, startValue: number, p: GuardParams): GuardYearState {
  return { year, startValue, floor: startValue * (1 - p.lossBudget), hwm: startValue, locked: false };
}

// Update the year state with today's close value; returns the target equity
// exposure (0..1) for the next session.
export function updateGuard(s: GuardYearState, value: number, p: GuardParams): number {
  s.hwm = Math.max(s.hwm, value);
  if (p.floorType === "TIPP") s.floor = Math.max(s.floor, s.hwm * (1 - p.lossBudget));
  if (value <= s.floor) s.locked = true;
  if (s.locked || value <= 0) return 0;
  return Math.max(0, Math.min(1, (p.multiplier * (value - s.floor)) / value));
}

export function needsResize(target: number, current: number, p: GuardParams): boolean {
  return Math.abs(target - current) > p.band || (target === 0 && current > 0);
}

// 18a score: 50% RS-raw rank + 50% trailing dividend-yield rank among Trend
// Template passers that have dividend data. Higher is better.
export type ScoreInput = { code: string; rsRaw: number; dy: number | null; tt: boolean };
export function pickTargets(pool: ScoreInput[], topN = 10): string[] {
  const ok = pool.filter((f) => f.tt && f.dy != null && Number.isFinite(f.rsRaw));
  const rank = (vals: { code: string; v: number }[]) => {
    const sorted = [...vals].sort((x, y) => x.v - y.v);
    const n = sorted.length;
    return new Map(sorted.map((it, k) => [it.code, n > 1 ? k / (n - 1) : 1]));
  };
  const rRS = rank(ok.map((f) => ({ code: f.code, v: f.rsRaw })));
  const rDY = rank(ok.map((f) => ({ code: f.code, v: f.dy as number })));
  return ok
    .map((f) => ({ code: f.code, s: 0.5 * rRS.get(f.code)! + 0.5 * rDY.get(f.code)! }))
    .sort((x, y) => y.s - x.s)
    .slice(0, topN)
    .map((x) => x.code);
}

export type Order = { code: string; side: "buy" | "sell"; shares: number };

// Whole-share (S株) orders to move from `holdings` to `targets` at
// `exposure` of `value`. Names staying in the list are only resized when the
// deviation exceeds `resizeTol` of their target allocation (keeps the number
// of hand-entered orders down). Returns orders plus targets that cannot be
// bought even one share at the allocation (unbuyable).
export function planOrders(args: {
  value: number;
  exposure: number;
  targets: string[];
  holdings: Map<string, number>;
  price: (code: string) => number | null;
  resizeTol?: number;
}): { orders: Order[]; unbuyable: string[] } {
  const { value, exposure, targets, holdings, price } = args;
  const tol = args.resizeTol ?? 0.2;
  const orders: Order[] = [];
  const unbuyable: string[] = [];
  const alloc = targets.length > 0 ? (value * exposure) / targets.length : 0;
  const targetSet = new Set(targets);

  for (const [code, sh] of holdings) {
    if (sh > 0 && (!targetSet.has(code) || exposure === 0)) orders.push({ code, side: "sell", shares: sh });
  }
  if (exposure === 0) return { orders, unbuyable };

  for (const code of targets) {
    const px = price(code);
    if (px == null || !(px > 0)) continue;
    const want = Math.floor(alloc / px);
    if (want === 0) unbuyable.push(code);
    const have = holdings.get(code) ?? 0;
    const diff = want - have;
    if (diff === 0) continue;
    if (have > 0 && Math.abs(diff) * px < tol * alloc) continue;
    orders.push({ code, side: diff > 0 ? "buy" : "sell", shares: Math.abs(diff) });
  }
  return { orders, unbuyable };
}

// 特定口座 (源泉徴収あり) tax, simplified: dividends taxed when credited;
// realised gains netted within the calendar year and taxed at year end.
export const TAX_RATE = 0.20315;
