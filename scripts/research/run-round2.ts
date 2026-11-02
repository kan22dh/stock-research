// Round 2 per PREREGISTRATION.md addendum (committed before this ran).
// Run: npx tsx scripts/research/run-round2.ts
import fs from "node:fs";
import path from "node:path";
import { loadLongDataset, run, stats, pct, pctRank, monthEnds, type Params, type Features } from "./engine";

const LONG = { to: "2025-10-31" };
const L1 = { to: "2017-04-30" };
const L2 = { from: "2017-04-25", to: "2025-10-31" };
const H1 = { from: "2017-11-25", to: "2021-10-31" };
const H2 = { from: "2021-10-25", to: "2025-10-31" };

const base = (over: Partial<Params> & { label: string }): Params => ({
  topN: 10, costBps: 20, requireTT: true, score: (f) => f.rsRaw, ...over,
});
const composite = (wRS: number) => (pool: Features[]) => {
  const ok = pool.filter((f) => f.dy != null);
  const rRS = pctRank(ok.map((f) => ({ code: f.code, v: f.rsRaw })));
  const rDY = pctRank(ok.map((f) => ({ code: f.code, v: f.dy as number })));
  return new Map(ok.map((f) => [f.code, wRS * rRS.get(f.code)! + (1 - wRS) * rDY.get(f.code)!]));
};
const reversal = (key: "ret36ex12" | "ret60ex12") => (pool: Features[]) => {
  const ok = pool.filter((f) => f[key] != null);
  const rRS = pctRank(ok.map((f) => ({ code: f.code, v: f.rsRaw })));
  const rLT = pctRank(ok.map((f) => ({ code: f.code, v: -(f[key] as number) })));
  return new Map(ok.map((f) => [f.code, rRS.get(f.code)! + rLT.get(f.code)!]));
};

const TRIALS: { id: string; group: string; P: Params }[] = [
  { id: "B0", group: "base", P: base({ label: "B0 基準(RS上位10+TT)" }) },
  { id: "17a", group: "17", P: base({ label: "17a 配当利回り上位10", requireTT: false, score: (f) => f.dy }) },
  { id: "17b", group: "17", P: base({ label: "17b 配当利回り上位20", requireTT: false, topN: 20, score: (f) => f.dy }) },
  { id: "18a", group: "18", P: base({ label: "18a RS50+配当50(TT)", score: undefined, scoreAll: composite(0.5) }) },
  { id: "18b", group: "18", P: base({ label: "18b RS70+配当30(TT)", score: undefined, scoreAll: composite(0.7) }) },
  { id: "18c", group: "18", P: base({ label: "18c RS30+配当70(TT)", score: undefined, scoreAll: composite(0.3) }) },
  { id: "19", group: "19", P: base({ label: "19  RS÷変動率120日", score: (f) => (f.vol120 ? f.rsRaw / f.vol120 : null) }) },
  { id: "19n", group: "19", P: base({ label: "19n RS÷変動率60日(隣接)", score: (f) => f.rsRaw / f.vol60 }) },
  { id: "20a", group: "20", P: base({ label: "20a RS+長期反転36ヶ月", score: undefined, scoreAll: reversal("ret36ex12") }) },
  { id: "20b", group: "20", P: base({ label: "20b RS+長期反転60ヶ月", score: undefined, scoreAll: reversal("ret60ex12") }) },
];

const WINDOWS = { LONG, L1, L2, H1, H2 } as const;
type W = keyof typeof WINDOWS;

const line = (label: string, s: ReturnType<typeof stats>) =>
  `${label.padEnd(24)} 年率 ${pct(s.cagr).padStart(7)}  DD ${pct(s.maxDD).padStart(7)}  対TOPIX勝率 ${(s.winVsBench * 100).toFixed(0)}%  絶対勝率 ${(s.absWin * 100).toFixed(0)}%  保有 ${s.avgHeld.toFixed(1)}`;

// --- trial 21: leveraged index timing (outside NISA, risk option) ---
function leveragedTiming(ds: ReturnType<typeof loadLongDataset>, months: number) {
  const lev = ds.extra.get("15700")!, nk = ds.extra.get("N225")!;
  const ends = monthEnds(nk).filter((d) => d >= lev.t[0]);
  const at = (s: { t: string[]; a: number[] }, d: string) => {
    let lo = 0, hi = s.t.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (s.t[m] <= d) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans;
  };
  const nkEnds = monthEnds(nk);
  let eq = 1, peak = 1, dd = 0;
  const monthly: { d: string; r: number; inMkt: boolean }[] = [];
  for (let m = 0; m < ends.length - 1; m++) {
    const d0 = ends[m], d1 = ends[m + 1];
    if (d1 > LONG.to) break;
    const k = nkEnds.indexOf(d0);
    if (k - months + 1 < 0) continue;
    let sum = 0;
    for (let j = k - months + 1; j <= k; j++) sum += nk.a[at(nk, nkEnds[j])];
    const inMkt = nk.a[at(nk, d0)] > sum / months;
    let r = 0;
    if (inMkt) {
      const i0 = at(lev, d0), i1 = at(lev, d1);
      for (let i = i0 + 1; i <= i1; i++) { // daily path for a true drawdown
        const dr = lev.a[i] / lev.a[i - 1] - 1;
        eq *= 1 + dr; peak = Math.max(peak, eq); dd = Math.min(dd, eq / peak - 1);
      }
      r = lev.a[i1] / lev.a[i0] - 1 - 0.002; // switch cost ~20bps
      eq *= 1 - 0.002;
    }
    monthly.push({ d: d1, r, inMkt });
  }
  const n = monthly.length;
  const total = monthly.reduce((e, x) => e * (1 + x.r), 1);
  let worst12 = Infinity;
  for (let i = 12; i <= n; i++) worst12 = Math.min(worst12, monthly.slice(i - 12, i).reduce((e, x) => e * (1 + x.r), 1) - 1);
  return { months: n, from: monthly[0]?.d, cagr: Math.pow(total, 12 / n) - 1, dailyMaxDD: dd, worst12, inMarketShare: monthly.filter((x) => x.inMkt).length / n };
}

function buyHold(s: { t: string[]; a: number[] }, from: string, to: string) {
  const i0 = s.t.findIndex((d) => d >= from);
  let i1 = s.t.length - 1; while (s.t[i1] > to) i1--;
  let peak = s.a[i0], dd = 0;
  for (let i = i0; i <= i1; i++) { peak = Math.max(peak, s.a[i]); dd = Math.min(dd, s.a[i] / peak - 1); }
  const yrs = (new Date(s.t[i1]).getTime() - new Date(s.t[i0]).getTime()) / (365.25 * 86400e3);
  return { cagr: Math.pow(s.a[i1] / s.a[i0], 1 / yrs) - 1, dailyMaxDD: dd };
}

const t0 = Date.now();
const ds = loadLongDataset();
console.log(`long dataset: ${ds.stocks.length} stocks, bench ${ds.bench.t[0]}→${ds.bench.t.at(-1)}`);

const res = TRIALS.map((T) => {
  const out = {} as Record<W, ReturnType<typeof stats>>;
  for (const w of Object.keys(WINDOWS) as W[]) out[w] = stats(run(ds, T.P, WINDOWS[w]));
  return { ...T, out };
});
const b = res[0].out;
console.log(`TOPIX(1306) LONG 年率 ${pct(b.LONG.benchCagr)} DD ${pct(b.LONG.benchMaxDD)} (${b.LONG.months}ヶ月) / L1 ${pct(b.L1.benchCagr)} / L2 ${pct(b.L2.benchCagr)} / H1 ${pct(b.H1.benchCagr)} / H2 ${pct(b.H2.benchCagr)}`);
for (const w of Object.keys(WINDOWS) as W[]) {
  console.log(`\n== ${w} ==`);
  for (const r of res) console.log(line(r.P.label, r.out[w]));
}

console.log("\n== 採用判定 (L1・L2・H1・H2すべてでB0より年率↑、DD悪化5pt以内、隣接も合格) ==");
const pass = (r: (typeof res)[number]) =>
  (["L1", "L2", "H1", "H2"] as W[]).every((w) => r.out[w].avgHeld < 1 || (r.out[w].cagr > b[w].cagr && r.out[w].maxDD >= b[w].maxDD - 0.05));
for (const r of res.slice(1)) {
  const neighbours = res.filter((x) => x.group === r.group && x.id !== r.id);
  const marks = (["L1", "L2", "H1", "H2"] as W[]).map((w) => `${w} ${r.out[w].avgHeld < 1 ? "-" : r.out[w].cagr > b[w].cagr && r.out[w].maxDD >= b[w].maxDD - 0.05 ? "✓" : "✗"}`).join(" ");
  console.log(`${r.P.label.padEnd(24)} ${marks}  隣接 ${neighbours.every(pass) ? "✓" : "✗"}  → ${pass(r) && neighbours.every(pass) ? "採用候補" : "不採用"}`);
}

console.log("\n== 21 レバレッジ指数タイミング(NISA外・リスク選択肢、v2候補の対象外) ==");
for (const m of [10, 6, 12]) {
  const r = leveragedTiming(ds, m);
  console.log(`1570 日経>${String(m).padStart(2)}ヶ月線で保有  ${r.months}ヶ月(${r.from}〜)  年率 ${pct(r.cagr)}  最大DD(日次) ${pct(r.dailyMaxDD)}  最悪12ヶ月 ${pct(r.worst12)}  市場滞在 ${(r.inMarketShare * 100).toFixed(0)}%`);
}
const lev = ds.extra.get("15700")!;
const bh1570 = buyHold(lev, "2013-04-01", LONG.to), bh1306 = buyHold(ds.bench, "2013-04-01", LONG.to);
console.log(`参考 1570買い持ち 年率 ${pct(bh1570.cagr)} DD ${pct(bh1570.dailyMaxDD)} / 1306買い持ち 年率 ${pct(bh1306.cagr)} DD ${pct(bh1306.dailyMaxDD)} (2013-04〜)`);

fs.writeFileSync(path.join(__dirname, "..", "..", ".cache", "round2.json"), JSON.stringify(res.map((r) => ({ id: r.id, label: r.P.label, out: r.out })), null, 1));
console.log(`\n${TRIALS.length - 1}+3 trials, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
