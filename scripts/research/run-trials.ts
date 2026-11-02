// Executes every trial in PREREGISTRATION.md on the development window and
// both halves. The 2025-11 → 2026-10 holdout is NOT touched here; see
// holdout.ts, which is run once on the final choice.
// Run: npx tsx scripts/research/run-trials.ts
import fs from "node:fs";
import path from "node:path";
import { loadDataset, run, stats, pct, pctRank, type Params, type Features } from "./engine";

const DEV = { to: "2025-10-31" };
const H1 = { to: "2021-10-31" };
const H2 = { from: "2021-10-25", to: "2025-10-31" };

const base = (over: Partial<Params> & { label: string }): Params => ({
  topN: 10,
  costBps: 20,
  requireTT: true,
  score: (f) => f.rsRaw,
  ...over,
});

const rsPlusReversal = (key: "ret36ex12" | "ret60ex12") => (pool: Features[]) => {
  const ok = pool.filter((f) => f[key] != null);
  const rRS = pctRank(ok.map((f) => ({ code: f.code, v: f.rsRaw })));
  const rLT = pctRank(ok.map((f) => ({ code: f.code, v: -(f[key] as number) })));
  return new Map(ok.map((f) => [f.code, rRS.get(f.code)! + rLT.get(f.code)!]));
};

export const TRIALS: Params[] = [
  base({ label: "B0 基準(RS上位10+TT)" }),
  // 1. index trend filter
  base({ label: "1a 指数トレンド 6ヶ月", indexTrendMonths: 6 }),
  base({ label: "1b 指数トレンド 10ヶ月", indexTrendMonths: 10 }),
  base({ label: "1c 指数トレンド 12ヶ月", indexTrendMonths: 12 }),
  // 2. risk-adjusted momentum
  base({ label: "2a RS÷変動率(60日)", score: (f) => f.rsRaw / f.vol60 }),
  base({ label: "2b RS÷変動率(120日)", score: (f) => (f.vol120 ? f.rsRaw / f.vol120 : null) }),
  // 3. 52-week-high proximity
  base({ label: "3  52週高値への近さ", score: (f) => f.high52prox + f.rsRaw * 1e-6 }),
  // 4. momentum + value proxy (long-term reversal)
  base({ label: "4a RS+長期反転(36ヶ月)", scoreAll: rsPlusReversal("ret36ex12") }),
  base({ label: "4b RS+長期反転(60ヶ月)", scoreAll: rsPlusReversal("ret60ex12") }),
  // 5. sector caps
  base({ label: "5a 業種上限2", maxPerSector: 2 }),
  base({ label: "5b 業種上限3", maxPerSector: 3 }),
  base({ label: "5c 業種上限4", maxPerSector: 4 }),
  // 6. breadth
  base({ label: "6a 上位15", topN: 15 }),
  base({ label: "6b 上位20", topN: 20 }),
  // 7. skip-month momentum
  base({ label: "7  12-1モメンタム", score: (f) => f.rsSkip }),
  // 8. liquidity floor
  base({ label: "8  流動性 1億円/日以上", filter: (f) => f.turnover60 >= 1e8 }),
];

function row(label: string, s: ReturnType<typeof stats>) {
  return `${label.padEnd(26)} 年率 ${pct(s.cagr).padStart(7)}  DD ${pct(s.maxDD).padStart(7)}  対TOPIX勝率 ${(s.winVsBench * 100).toFixed(0)}%  絶対勝率 ${(s.absWin * 100).toFixed(0)}%  保有 ${s.avgHeld.toFixed(1)}`;
}

export function evaluate(ds: ReturnType<typeof loadDataset>, trials: Params[]) {
  const results = trials.map((P) => {
    const dev = stats(run(ds, P, DEV));
    const h1 = stats(run(ds, P, H1));
    const h2 = stats(run(ds, P, H2));
    return { label: P.label, dev, h1, h2 };
  });
  return results;
}

if (require.main === module) {
  const t0 = Date.now();
  const ds = loadDataset();
  console.log(`dataset built ${ds.builtAt}, ${ds.stocks.length} stocks`);
  const results = evaluate(ds, TRIALS);
  const b = results[0];
  console.log(`\nTOPIX(1306) dev 年率 ${pct(b.dev.benchCagr)} DD ${pct(b.dev.benchMaxDD)} / H1 ${pct(b.h1.benchCagr)} / H2 ${pct(b.h2.benchCagr)}  (${b.dev.months}ヶ月)`);
  for (const [name, key] of [["開発期間(全体)", "dev"], ["前半 H1", "h1"], ["後半 H2", "h2"]] as const) {
    console.log(`\n== ${name} ==`);
    for (const r of results) console.log(row(r.label, r[key]));
  }
  console.log("\n== 採用判定 (両半期でB0より年率↑ かつ DD悪化5pt以内) ==");
  for (const r of results.slice(1)) {
    const beat = (k: "h1" | "h2") => r[k].cagr > b[k].cagr && r[k].maxDD >= b[k].maxDD - 0.05;
    console.log(`${r.label.padEnd(26)} H1 ${beat("h1") ? "✓" : "✗"}  H2 ${beat("h2") ? "✓" : "✗"}  (H1 ${pct(r.h1.cagr - b.h1.cagr)} / H2 ${pct(r.h2.cagr - b.h2.cagr)})`);
  }
  fs.writeFileSync(
    path.join(__dirname, "..", "..", ".cache", "trials.json"),
    JSON.stringify(results, null, 1),
  );
  console.log(`\n${TRIALS.length} trials, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
