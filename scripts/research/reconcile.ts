// Engine reconciliation: old src/lib/backtest.ts runBacktest vs new engine,
// both on the same local dataset and the same window. If they disagree, one
// of them is wrong and no trial result can be trusted.
import { runBacktest } from "../../src/lib/backtest";
import { loadDataset, run, stats, pct, monthEnds } from "./engine";

const ds = loadDataset();
const byCode = new Map(ds.stocks.map((s) => [s.code, { dates: s.t, closes: s.a }]));
const bench = { dates: ds.bench.t, closes: ds.bench.a };

for (const end of ["2025-10-31", "2026-06-30", "2026-10-31"]) {
  const old = runBacktest(byCode, bench, { topN: 10, requireTrendTemplate: true, costPerSideBps: 20, stopLossPct: 0, endDate: end })!;
  const first = old.points[0].time;
  const neu = stats(run(ds, { label: "B0", topN: 10, costBps: 20, requireTT: true, score: (f) => f.rsRaw }, { from: first, to: end }));
  console.log(`~${end}  OLD ${old.months}m ${pct(old.cagr)} (bench ${pct(old.benchCagr)}) DD ${pct(old.maxDrawdown)}  |  NEW ${neu.months}m ${pct(neu.cagr)} (bench ${pct(neu.benchCagr)}) DD ${pct(neu.maxDD)}  start ${first}`);
}
const ends = monthEnds(ds.bench);
console.log("bench month-ends:", ends[0], "…", ends.at(-1), ends.length);
