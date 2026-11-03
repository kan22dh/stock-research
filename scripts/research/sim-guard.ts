// Round 3 simulator (see PREREGISTRATION.md, commit 53cfb63). Daily event
// loop with SBI S株 mechanics:
//   - signal on the close, order that evening → fill at the NEXT trading
//     day's open; no open that day → order retried next day (max 5 days)
//   - whole shares, commission param (default 0 = ゼロ革命), no spread
//   - dividends credited on the ex-date net of 20.315% (based on holdings at
//     the previous close); realised gains netted per calendar year and taxed
//     on the year's last session (特定口座, no carry-forward)
// Uses the shared pure logic in src/lib/guard-core.ts.
// Run: npx tsx scripts/research/sim-guard.ts
import fs from "node:fs";
import path from "node:path";
import { features } from "./engine";
import {
  newYear, updateGuard, needsResize, pickTargets, planOrders, TAX_RATE,
  type GuardParams, type Order,
} from "../../src/lib/guard-core";

type S = {
  code: string; name: string; sector: string | null;
  t: string[]; o: number[]; c: number[]; a: number[]; v: number[];
  divs: [string, number][];
  pre: Float64Array; idx: Map<string, number>;
};

const DIR = path.join(__dirname, "..", "..", ".cache", "long2");
const BENCH = "13060";
const LO = 0.6, HI = 1.7;

export function load(): { stocks: S[]; bench: S } {
  const out: S[] = [];
  for (const f of fs.readdirSync(DIR)) {
    const r = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
    if (r.code === "15700" || r.code === "N225") continue;
    let { t, o, c, a, v, divs } = r as { t: string[]; o: number[]; c: number[]; a: number[]; v: number[]; divs: [string, number][] };
    if (r.code === BENCH) {
      // 1306's 10:1 split on 2015-01-05 is unadjusted in Yahoo (round 2 finding)
      const k = t.indexOf("2015-01-05");
      if (k > 0 && c[k] / c[k - 1] < 0.2) {
        o = o.map((x, i) => (i < k ? x / 10 : x)); c = c.map((x, i) => (i < k ? x / 10 : x)); a = a.map((x, i) => (i < k ? x / 10 : x));
        divs = divs.map(([d, amt]) => [d, d < "2015-01-05" ? amt / 10 : amt]);
      }
    } else {
      // Data breaks: one-day close or open-vs-prev-close move beyond ×0.6/×1.7
      // (impossible under TSE price limits) → drop history before the last one.
      let last = -1;
      for (let i = 1; i < c.length; i++) {
        const rc = c[i] / c[i - 1], ro = o[i] / c[i - 1], ra = a[i] / a[i - 1];
        if (rc < LO || rc > HI || ro < LO || ro > HI || ra < LO || ra > HI) last = i;
      }
      if (last > 0) {
        const from = t[last];
        t = t.slice(last); o = o.slice(last); c = c.slice(last); a = a.slice(last); v = v.slice(last);
        divs = divs.filter(([d]) => d >= from);
      }
    }
    if (t.length < 60) continue;
    const pre = new Float64Array(a.length + 1);
    for (let i = 0; i < a.length; i++) pre[i + 1] = pre[i] + a[i];
    out.push({ code: r.code, name: r.name, sector: r.sector, t, o, c, a, v, divs, pre, idx: new Map(t.map((d, i) => [d, i])) });
  }
  const bench = out.find((s) => s.code === BENCH)!;
  return { stocks: out.filter((s) => s.code !== BENCH), bench };
}

// Monthly target lists (independent of the guard config → computed once).
// Refreshed on the close of each month's FIRST session: the live evening job
// can tell "first session of the month" on the day, but not "last session".
export function monthlyTargets(stocks: S[], days: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (let k = 0; k < days.length; k++) {
    const d = days[k];
    const isMonthStart = k === 0 || days[k - 1].slice(0, 7) !== d.slice(0, 7);
    if (!isMonthStart) continue;
    const pool = [];
    for (const s of stocks) {
      const i = s.idx.get(d);
      if (i == null) continue; // must have traded on the signal day
      const f = features(s as never, i);
      if (!f) continue;
      pool.push({ code: s.code, rsRaw: f.rsRaw, dy: f.dy, tt: f.tt });
    }
    if (pool.length >= 50) out.set(d, pickTargets(pool, 10));
  }
  return out;
}

// fixedExposure: reference rows only (not trials) — a constant stock share,
// resized when it drifts beyond the band. Answers "does the guard protect
// anything a plain low-exposure mix wouldn't?".
export type SimConfig = GuardParams & { label: string; capital: number; commission: number; overlay: boolean; fixedExposure?: number; taxRate?: number; resizeTol?: number };
export type YearRow = { year: number; ret: number; startValue: number; endValue: number; taxPaid: number; locked: boolean };

export function simulate(cfg: SimConfig, data: { stocks: S[]; bench: S; days: string[]; targets: Map<string, string[]> }) {
  const byCode = new Map(data.stocks.map((s) => [s.code, s]));
  const lastClose = new Map<string, number>();
  const holdings = new Map<string, number>();
  const cost = new Map<string, number>(); // total cost basis per code
  let cash = cfg.capital;
  let pending: (Order & { tries: number })[] = [];
  let targets: string[] = [];
  let realizedYtd = 0;
  let gs = newYear(Number(data.days[0].slice(0, 4)), cash, cfg);
  let prevValue = cash;
  const years: YearRow[] = [];
  let taxYtd = 0;
  let orderDays = 0, unbuyableCount = 0, rebalanceEvents = 0, cashShareSum = 0;
  let peak = cash, maxDD = 0;
  const curve: { d: string; v: number }[] = [];
  const gapDays = new Set(["2011-03-14", "2011-03-15", "2020-03-09", "2020-03-13", "2024-08-05"]);
  const gapRet: Record<string, number> = {};

  for (let k = 0; k < data.days.length; k++) {
    const d = data.days[k];
    const y = Number(d.slice(0, 4));
    if (y !== gs.year) gs = newYear(y, prevValue, cfg);

    // 1) dividends on holdings carried from the previous close
    for (const [code, sh] of holdings) {
      if (sh <= 0) continue;
      const s = byCode.get(code)!;
      for (const [exd, amt] of s.divs) {
        if (exd === d) {
          const gross = sh * amt;
          cash += gross * (1 - (cfg.taxRate ?? TAX_RATE));
          taxYtd += gross * (cfg.taxRate ?? TAX_RATE);
        }
      }
    }

    // 2) fill pending orders at today's open (sells first, then buys)
    if (pending.length > 0) {
      const next: typeof pending = [];
      const sells = pending.filter((o) => o.side === "sell"), buys = pending.filter((o) => o.side === "buy");
      for (const o of [...sells, ...buys]) {
        const s = byCode.get(o.code)!;
        const i = s.idx.get(d);
        if (i == null || !(s.o[i] > 0)) {
          if (o.tries < 5) next.push({ ...o, tries: o.tries + 1 });
          continue;
        }
        const px = s.o[i];
        if (o.side === "sell") {
          const have = holdings.get(o.code) ?? 0;
          const sh = Math.min(have, o.shares);
          if (sh <= 0) continue;
          const proceeds = sh * px * (1 - cfg.commission);
          const basis = ((cost.get(o.code) ?? 0) * sh) / have;
          realizedYtd += proceeds - basis;
          cash += proceeds;
          holdings.set(o.code, have - sh);
          cost.set(o.code, (cost.get(o.code) ?? 0) - basis);
          if (have - sh === 0) { holdings.delete(o.code); cost.delete(o.code); }
        } else {
          const unit = px * (1 + cfg.commission);
          const sh = Math.min(o.shares, Math.floor(cash / unit));
          if (sh <= 0) continue;
          cash -= sh * unit;
          holdings.set(o.code, (holdings.get(o.code) ?? 0) + sh);
          cost.set(o.code, (cost.get(o.code) ?? 0) + sh * unit);
        }
      }
      pending = next;
    }

    // 3) mark to market at the close
    let stockValue = 0;
    for (const [code, sh] of holdings) {
      const s = byCode.get(code)!;
      const i = s.idx.get(d);
      if (i != null) lastClose.set(code, s.c[i]);
      stockValue += sh * (lastClose.get(code) ?? 0);
    }
    for (const code of targets) {
      const s = byCode.get(code);
      const i = s?.idx.get(d);
      if (s && i != null) lastClose.set(code, s.c[i]);
    }
    let value = cash + stockValue;

    // 4) year end: settle capital-gains tax on the year's net realised gain
    const yearEnd = k === data.days.length - 1 || data.days[k + 1].slice(0, 4) !== d.slice(0, 4);
    if (yearEnd) {
      const cgt = Math.max(0, realizedYtd) * (cfg.taxRate ?? TAX_RATE);
      cash -= cgt;
      value -= cgt;
      years.push({ year: y, ret: value / gs.startValue - 1, startValue: gs.startValue, endValue: value, taxPaid: taxYtd + cgt, locked: gs.locked });
      realizedYtd = 0;
      taxYtd = 0;
    }

    if (gapDays.has(d)) gapRet[d] = value / prevValue - 1;
    peak = Math.max(peak, value);
    maxDD = Math.min(maxDD, value / peak - 1);
    cashShareSum += value > 0 ? cash / value : 1;
    if (k % 5 === 0 || yearEnd) curve.push({ d, v: Math.round(value) });

    // 5) decide tomorrow's orders
    const exposure = cfg.fixedExposure != null ? cfg.fixedExposure : cfg.overlay ? updateGuard(gs, value, cfg) : 1;
    const currentExp = value > 0 ? stockValue / value : 0;
    const newList = data.targets.get(d);
    let replan = false;
    if (newList) {
      targets = newList;
      replan = true;
      // New entrants need today's close for sizing. (Bug fixed 2026-11-04:
      // they were priced only from the NEXT day on, so on the refresh day
      // planOrders skipped them and the money sat in cash — 16% on average
      // in the uncapped run. The live job always had their closes.)
      for (const code of newList) {
        const s = byCode.get(code);
        const i = s?.idx.get(d);
        if (s && i != null) lastClose.set(code, s.c[i]);
      }
    }
    if ((cfg.overlay || cfg.fixedExposure != null) && needsResize(exposure, currentExp, cfg)) replan = true;
    if (replan && pending.length === 0) {
      const { orders, unbuyable } = planOrders({
        value, exposure, targets, holdings,
        price: (code) => lastClose.get(code) ?? null,
        resizeTol: cfg.resizeTol,
      });
      if (orders.length > 0) { orderDays++; rebalanceEvents++; }
      unbuyableCount += unbuyable.length;
      pending = orders.map((o) => ({ ...o, tries: 0 }));
    }
    prevValue = value;
  }

  const first = data.days[0], last = data.days[data.days.length - 1];
  const yrs = (new Date(last).getTime() - new Date(first).getTime()) / (365.25 * 86400e3);
  const full = years.filter((r) => r.year < 2026);
  return {
    label: cfg.label,
    cagr: Math.pow(prevValue / cfg.capital, 1 / yrs) - 1,
    finalValue: prevValue,
    maxDD,
    years,
    worstYear: Math.min(...full.map((r) => r.ret)),
    negativeYears: full.filter((r) => r.ret < 0).length,
    breachYears: full.filter((r) => r.ret < -cfg.lossBudget).map((r) => `${r.year}:${(r.ret * 100).toFixed(1)}%`),
    orderDaysPerYear: orderDays / yrs,
    unbuyablePerRebalance: rebalanceEvents ? unbuyableCount / rebalanceEvents : 0,
    avgCash: cashShareSum / data.days.length,
    gapRet,
    curve,
  };
}

// TOPIX (1306) buy & hold in the same taxable account: dividends net of tax.
function topixBuyHold(bench: S, days: string[], capital: number) {
  let sh = Math.floor(capital / bench.o[bench.idx.get(days[1])!]);
  let cash = capital - sh * bench.o[bench.idx.get(days[1])!];
  const years: YearRow[] = [];
  let ys = capital, prev = capital, peak = capital, maxDD = 0;
  const curve: { d: string; v: number }[] = [];
  for (let k = 0; k < days.length; k++) {
    const d = days[k], i = bench.idx.get(d)!;
    if (k > 1) for (const [exd, amt] of bench.divs) if (exd === d) cash += sh * amt * (1 - TAX_RATE);
    // reinvest cash in whole shares
    const add = Math.floor(cash / bench.c[i]);
    if (add > 0 && k > 1) { sh += add; cash -= add * bench.c[i]; }
    const v = cash + sh * bench.c[i];
    if (k > 0 && d.slice(0, 4) !== days[k - 1].slice(0, 4)) ys = prev;
    if (k === days.length - 1 || days[k + 1].slice(0, 4) !== d.slice(0, 4))
      years.push({ year: Number(d.slice(0, 4)), ret: v / ys - 1, startValue: ys, endValue: v, taxPaid: 0, locked: false });
    peak = Math.max(peak, v); maxDD = Math.min(maxDD, v / peak - 1);
    if (k % 5 === 0) curve.push({ d, v: Math.round(v) });
    prev = v;
  }
  const yrs = (new Date(days.at(-1)!).getTime() - new Date(days[0]).getTime()) / (365.25 * 86400e3);
  const full = years.filter((r) => r.year < 2026);
  return { label: "TOPIX(1306)買い持ち", cagr: Math.pow(prev / capital, 1 / yrs) - 1, finalValue: prev, maxDD, years,
    worstYear: Math.min(...full.map((r) => r.ret)), negativeYears: full.filter((r) => r.ret < 0).length, curve };
}

if (require.main === module) {
  const t0 = Date.now();
  const { stocks, bench } = load();
  const days = bench.t.filter((d) => d >= "2009-01-05" && d <= "2026-10-30");
  console.log(`stocks ${stocks.length}, days ${days.length} (${days[0]} → ${days.at(-1)})`);
  const targets = monthlyTargets(stocks, days);
  console.log(`target lists: ${targets.size} months (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  const data = { stocks, bench, days, targets };
  const pct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

  const results: ReturnType<typeof simulate>[] = [];
  const base = { band: 0.1, commission: 0, overlay: true };
  const run = (cfg: SimConfig) => { const r = simulate(cfg, data); results.push(r); return r; };
  const line = (r: ReturnType<typeof simulate>) =>
    `${r.label.padEnd(30)} 税引後年率 ${pct(r.cagr).padStart(7)}  最悪年 ${pct(r.worstYear).padStart(7)}  負け年 ${String(r.negativeYears).padStart(2)}/17  最大DD ${pct(r.maxDD).padStart(7)}  発注日/年 ${r.orderDaysPerYear.toFixed(0).padStart(3)}  現金平均 ${(r.avgCash * 100).toFixed(0)}%  L超過 ${r.breachYears.join(" ") || "なし"}`;

  console.log("\n== 既定(事前に選択): L=5%, m=4, TIPP, 元手60万, 手数料0 ==");
  console.log(line(run({ label: "既定 L5 m4 TIPP", lossBudget: 0.05, multiplier: 4, floorType: "TIPP", capital: 600_000, ...base })));

  console.log("\n== 比較 ==");
  console.log(line(run({ label: "18a 上限なし(常に100%株)", lossBudget: 0.05, multiplier: 4, floorType: "TIPP", capital: 600_000, band: 0.1, commission: 0, overlay: false })));
  const tb = topixBuyHold(bench, days, 600_000);
  console.log(`${tb.label.padEnd(30)} 税引後年率 ${pct(tb.cagr).padStart(7)}  最悪年 ${pct(tb.worstYear).padStart(7)}  負け年 ${String(tb.negativeYears).padStart(2)}/17  最大DD ${pct(tb.maxDD).padStart(7)}`);

  console.log("\n== 参照: 株の比率を固定(残り現金) ==");
  const fixed = [0.13, 0.2].map((x) => simulate({ label: `固定 株${Math.round(x * 100)}%`, lossBudget: 0.05, multiplier: 4, floorType: "TIPP", capital: 600_000, band: 0.05, commission: 0, overlay: false, fixedExposure: x }, data));
  for (const r of fixed) console.log(line(r));

  console.log("\n== グリッド(L × m × 床の種類) 元手60万・手数料0 ==");
  for (const L of [0.03, 0.05, 0.08]) for (const m of [3, 4, 5]) for (const ft of ["CPPI", "TIPP"] as const) {
    if (L === 0.05 && m === 4 && ft === "TIPP") continue;
    console.log(line(run({ label: `L${L * 100} m${m} ${ft}`, lossBudget: L, multiplier: m, floorType: ft, capital: 600_000, ...base })));
  }

  console.log("\n== 感度(既定設定) ==");
  console.log(line(run({ label: "既定・元手300万", lossBudget: 0.05, multiplier: 4, floorType: "TIPP", capital: 3_000_000, ...base })));
  console.log(line(run({ label: "既定・手数料0.1%/片道", lossBudget: 0.05, multiplier: 4, floorType: "TIPP", capital: 600_000, band: 0.1, commission: 0.001, overlay: true })));

  const def = results[0];
  console.log("\n== 既定の年次(税引後) ==");
  console.log(def.years.map((r) => `${r.year} ${pct(r.ret)}${r.locked ? "(下限到達→現金)" : ""}`).join(" | "));
  console.log("TOPIX: " + tb.years.map((r) => `${r.year} ${pct(r.ret)}`).join(" | "));
  console.log("ギャップ日の既定口座の1日損益: " + Object.entries(def.gapRet).map(([d, r]) => `${d} ${pct(r)}`).join(" / "));

  const outPath = path.join(__dirname, "..", "..", "src", "data", "guard-sim.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const slim = (r: any) => ({ label: r.label, cagr: r.cagr, finalValue: r.finalValue, maxDD: r.maxDD, worstYear: r.worstYear, negativeYears: r.negativeYears,
    breachYears: r.breachYears ?? [], orderDaysPerYear: r.orderDaysPerYear ?? null, avgCash: r.avgCash ?? null, unbuyablePerRebalance: r.unbuyablePerRebalance ?? null,
    years: r.years.map((y: YearRow) => ({ year: y.year, ret: y.ret, taxPaid: Math.round(y.taxPaid), locked: y.locked })) });
  fs.writeFileSync(outPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    window: { from: days[0], to: days.at(-1) },
    assumptions: { capital: 600_000, commission: 0, tax: TAX_RATE, fill: "翌営業日の前場始値(S株・夜間発注)", account: "特定口座(源泉徴収あり)" },
    default: { ...slim(def), gapRet: def.gapRet },
    raw18a: slim(results[1]),
    topix: slim(tb),
    fixed: fixed.map(slim),
    grid: results.slice(2, 19).map(slim),
    sensitivity: results.slice(19).map(slim),
    curves: { default: def.curve, raw18a: results[1].curve, topix: tb.curve },
  }));
  console.log(`\n→ ${outPath}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
