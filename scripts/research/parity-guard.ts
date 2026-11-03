// Parity test: the live target selection (src/lib/guard-data.ts on a 2-year
// window, as the evening job fetches it) must pick the same 18a targets as
// the research simulator (engine.features on full history) for past
// first-sessions of the month. Also times a live universe fetch.
// Run: npx tsx scripts/research/parity-guard.ts [--live]
import fs from "node:fs";
import path from "node:path";
import { features } from "./engine";
import { trimBreaks, guardFeatures, fetchGuardBars, mapPool, type GuardBars } from "../../src/lib/guard-data";
import { pickTargets } from "../../src/lib/guard-core";

const DIR = path.join(__dirname, "..", "..", ".cache", "long2");
const raw = fs.readdirSync(DIR).map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")))
  .filter((r) => !["13060", "15700", "N225"].includes(r.code));

// Simulator-side series (same trim as sim-guard.ts load()).
const simSeries = raw.map((r) => {
  const b = trimBreaks({ t: r.t, o: r.o, c: r.c, a: r.a, v: r.v, divs: r.divs });
  const pre = new Float64Array(b.a.length + 1);
  for (let i = 0; i < b.a.length; i++) pre[i + 1] = pre[i] + b.a[i];
  return { code: r.code, sector: r.sector, ...b, pre, idx: new Map(b.t.map((d, i) => [d, i])) };
});

let allMatch = true;
for (const d of ["2026-08-03", "2026-09-01", "2026-10-01"]) {
  const simPool = [], livePool = [];
  for (const s of simSeries) {
    const i = s.idx.get(d);
    if (i == null) continue;
    const f = features(s as never, i);
    if (f) simPool.push({ code: s.code, rsRaw: f.rsRaw, dy: f.dy, tt: f.tt });
    // Live side: only the last ~2 years up to d, re-trimmed, like a fresh fetch.
    const from = i - 490 < 0 ? 0 : i - 490;
    const win: GuardBars = trimBreaks({
      t: s.t.slice(from, i + 1), o: s.o.slice(from, i + 1), c: s.c.slice(from, i + 1),
      a: s.a.slice(from, i + 1), v: s.v.slice(from, i + 1), divs: s.divs.filter(([x]) => x <= d),
    });
    const g = guardFeatures(win);
    if (g) livePool.push({ code: s.code, ...g });
  }
  const a = pickTargets(simPool, 10), b = pickTargets(livePool, 10);
  const same = a.join() === b.join();
  allMatch &&= same;
  console.log(`${d}  sim pool ${simPool.length} / live pool ${livePool.length}  ${same ? "MATCH" : "DIFF"}\n  sim : ${a.join(" ")}\n  live: ${b.join(" ")}`);
}
console.log(allMatch ? "\nPARITY OK" : "\nPARITY FAILED");

if (process.argv.includes("--live")) {
  const t0 = Date.now();
  const codes = simSeries.map((s) => s.code);
  const res = await_(mapPool(codes, 8, async (c) => fetchGuardBars(c, "2y")));
  res.then((rs) => {
    const ok = rs.filter(Boolean).length;
    console.log(`live fetch: ${ok}/${codes.length} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  });
}
function await_<T>(p: Promise<T>) { return p; }
