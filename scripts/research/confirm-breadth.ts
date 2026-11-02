// Confirmation of round-1 survivors (6a top15, 6b top20) on the round-2 long
// windows, per the addendum's adoption rule. Also reports the 10y dev stats.
import { loadDataset, loadLongDataset, run, stats, pct, type Params } from "./engine";
const mk = (topN: number): Params => ({ label: `top${topN}`, topN, costBps: 20, requireTT: true, score: (f) => f.rsRaw });
const W = {
  LONG: { to: "2025-10-31" }, L1: { to: "2017-04-30" }, L2: { from: "2017-04-25", to: "2025-10-31" },
  H1: { from: "2017-11-25", to: "2021-10-31" }, H2: { from: "2021-10-25", to: "2025-10-31" },
};
const long = loadLongDataset(), ten = loadDataset();
for (const [name, ds] of [["10y", ten], ["long", long]] as const) {
  console.log(`\n[${name} dataset]`);
  const wins = name === "10y" ? (["H1", "H2"] as const) : (["LONG", "L1", "L2", "H1", "H2"] as const);
  for (const w of name === "10y" ? (["H1", "H2"] as const) : wins) {
    const b = stats(run(ds as any, mk(10), (W as any)[w]));
    const out = [10, 15, 20, 25, 30].map((n) => { const s = stats(run(ds as any, mk(n), (W as any)[w])); return `top${n} ${pct(s.cagr)}/DD${pct(s.maxDD)}${n !== 10 ? (s.cagr > b.cagr && s.maxDD >= b.maxDD - 0.05 ? "✓" : "✗") : ""}`; });
    console.log(`${w.padEnd(5)} TOPIX ${pct(b.benchCagr)} | ${out.join("  ")}`);
  }
}
const d10 = stats(run(ten, mk(10), { to: "2025-10-31" })), d20 = stats(run(ten, mk(20), { to: "2025-10-31" })), d15 = stats(run(ten, mk(15), { to: "2025-10-31" }));
console.log(`\n10y dev: top10 ${pct(d10.cagr)} DD ${pct(d10.maxDD)} | top15 ${pct(d15.cagr)} DD ${pct(d15.maxDD)} | top20 ${pct(d20.cagr)} DD ${pct(d20.maxDD)} | TOPIX ${pct(d10.benchCagr)}`);
