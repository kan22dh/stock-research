// Sanity check of trailing dividend yields used by 18a holdings (dev window only).
import { loadLongDataset, run, features, pctRank, type Features } from "./engine";
const ds = loadLongDataset();
const composite = (pool: Features[]) => {
  const ok = pool.filter((f) => f.dy != null);
  const rRS = pctRank(ok.map((f) => ({ code: f.code, v: f.rsRaw })));
  const rDY = pctRank(ok.map((f) => ({ code: f.code, v: f.dy as number })));
  return new Map(ok.map((f) => [f.code, 0.5 * rRS.get(f.code)! + 0.5 * rDY.get(f.code)!]));
};
const held: { d: string; code: string }[] = [];
run(ds, { label: "18a", topN: 10, costBps: 20, requireTT: true, scoreAll: composite, onMonth: (d, h) => h.forEach((x) => held.push({ d, code: x.code })) }, { to: "2025-10-31" });
const byCode = new Map(ds.stocks.map((s) => [s.code, s]));
const at = (s: any, d: string) => { let i = s.t.length - 1; while (i >= 0 && s.t[i] > d) i--; return i; };
const rows = held.map(({ d, code }) => { const s = byCode.get(code)!; const f = features(s as any, at(s, d))!; return { d, code, name: s.name, dy: f.dy ?? 0 }; });
const dys = rows.map((r) => r.dy).sort((a, b) => a - b);
console.log(`holdings-months ${rows.length}; dy median ${(dys[Math.floor(dys.length / 2)] * 100).toFixed(2)}%  p90 ${(dys[Math.floor(dys.length * 0.9)] * 100).toFixed(2)}%  max ${(dys.at(-1)! * 100).toFixed(2)}%`);
console.log("dy > 8%:"); for (const r of rows.filter((r) => r.dy > 0.08).slice(0, 20)) console.log(`  ${r.d} ${r.code} ${r.name} ${(r.dy * 100).toFixed(1)}%`);
const recent = rows.filter((r) => r.d >= "2025-01-01").slice(0, 12);
console.log("recent sample:"); for (const r of recent) console.log(`  ${r.d} ${r.code} ${r.name} ${(r.dy * 100).toFixed(2)}%`);
