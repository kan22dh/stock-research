// Re-derives the withdrawal thresholds on REPAIRED data (2026-11). Same three
// measures as scripts/rolling-worst-analysis.ts, computed for B0 on both the
// 10y dataset (2017-11 →) and the long dataset (2009 →), through 2026-10.
import { loadDataset, loadLongDataset, run, type MonthRow } from "./engine";
const P = { label: "B0", topN: 10, costBps: 20, requireTT: true, score: (f: any) => f.rsRaw };
function worst(rows: MonthRow[]) {
  let e = 1, peak = 1, dd = 0; const se = [1], be = [1]; let b = 1;
  for (const r of rows) { e *= 1 + r.strat; b *= 1 + r.bench; se.push(e); be.push(b); peak = Math.max(peak, e); dd = Math.min(dd, e / peak - 1); }
  const roll = (k: number) => { let w = Infinity; for (let i = k; i < se.length; i++) w = Math.min(w, (se[i] / se[i - k] - 1) - (be[i] / be[i - k] - 1)); return w; };
  return { months: rows.length, maxDD: dd, ex12: roll(12), ex24: roll(24) };
}
const f = (x: number) => (x * 100).toFixed(1) + "%";
for (const [name, ds] of [["10y(2017-11→2026-10)", loadDataset()], ["long(2009-01→2026-10)", loadLongDataset()]] as const) {
  const w = worst(run(ds as any, P, { to: "2026-10-31" }));
  console.log(`${name}: ${w.months}m  maxDD ${f(w.maxDD)}  worst12m超過 ${f(w.ex12)}  worst24m超過 ${f(w.ex24)}`);
}
