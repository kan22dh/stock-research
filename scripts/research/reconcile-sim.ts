// Reconciles the round-3 event-driven simulator (next-open fills, whole
// shares, first-session refresh) with the round-2 engine (month-end closes,
// fractional equal weight) on 18a with tax switched off. They model fills
// differently, so a gap of a point or two is expected; a large gap = a bug.
import { load, monthlyTargets, simulate } from "./sim-guard";
import { loadLongDataset, run, stats, pctRank, type Features } from "./engine";

const { stocks, bench } = load();
const days = bench.t.filter((d) => d >= "2009-01-05" && d <= "2025-10-31");
const targets = monthlyTargets(stocks, days);
const sim = simulate({ label: "18a sim tax0", lossBudget: 0.05, multiplier: 4, floorType: "TIPP", band: 0.1, capital: 3_000_000, commission: 0, overlay: false, taxRate: 0 }, { stocks, bench, days, targets });

const ds = loadLongDataset();
const composite = (pool: Features[]) => {
  const ok = pool.filter((f) => f.dy != null);
  const rRS = pctRank(ok.map((f) => ({ code: f.code, v: f.rsRaw })));
  const rDY = pctRank(ok.map((f) => ({ code: f.code, v: f.dy as number })));
  return new Map(ok.map((f) => [f.code, 0.5 * rRS.get(f.code)! + 0.5 * rDY.get(f.code)!]));
};
const eng = stats(run(ds, { label: "18a", topN: 10, costBps: 0, requireTT: true, scoreAll: composite }, { to: "2025-10-31" }));
console.log(`simulator (tax 0, ¥3M, next-open fills): ${(sim.cagr * 100).toFixed(1)}%/yr, maxDD ${(sim.maxDD * 100).toFixed(1)}%`);
console.log(`engine    (no tax, month-end closes)    : ${(eng.cagr * 100).toFixed(1)}%/yr, maxDD ${(eng.maxDD * 100).toFixed(1)}%`);
