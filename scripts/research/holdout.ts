// The ONE holdout run declared in PREREGISTRATION.md (commit bbd0f65).
// Runs exactly three series — 18a, B0, TOPIX — on 2025-10-31 → 2026-10-30.
import { loadLongDataset, run, stats, pct, pctRank, type Features } from "./engine";
const ds = loadLongDataset();
const W = { from: "2025-10-25", to: "2026-10-31" };
const composite = (pool: Features[]) => {
  const ok = pool.filter((f) => f.dy != null);
  const rRS = pctRank(ok.map((f) => ({ code: f.code, v: f.rsRaw })));
  const rDY = pctRank(ok.map((f) => ({ code: f.code, v: f.dy as number })));
  return new Map(ok.map((f) => [f.code, 0.5 * rRS.get(f.code)! + 0.5 * rDY.get(f.code)!]));
};
const r18 = run(ds, { label: "18a", topN: 10, costBps: 20, requireTT: true, scoreAll: composite }, W);
const rB0 = run(ds, { label: "B0", topN: 10, costBps: 20, requireTT: true, score: (f) => f.rsRaw }, W);
const s18 = stats(r18), sB0 = stats(rB0);
const tot = (rows: typeof r18, k: "strat" | "bench") => rows.reduce((e, r) => e * (1 + r[k]), 1) - 1;
console.log(`window ${r18[0].d0} → ${r18.at(-1)!.d1} (${r18.length} months)`);
console.log(`TOPIX  total ${pct(tot(r18, "bench"))}  DD ${pct(s18.benchMaxDD)}`);
console.log(`B0     total ${pct(tot(rB0, "strat"))}  DD ${pct(sB0.maxDD)}`);
console.log(`18a    total ${pct(tot(r18, "strat"))}  DD ${pct(s18.maxDD)}`);
console.log("monthly (18a / B0 / TOPIX):"); r18.forEach((r, i) => console.log(`  ${r.d1}  ${pct(r.strat).padStart(7)} ${pct(rB0[i].strat).padStart(7)} ${pct(r.bench).padStart(7)}`));
const pass = tot(r18, "strat") > tot(r18, "bench") && tot(r18, "strat") > tot(rB0, "strat") && s18.maxDD >= sB0.maxDD - 0.05;
console.log(`\nVERDICT: ${pass ? "PASS" : "FAIL"}`);
