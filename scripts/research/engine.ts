// Fast local backtest engine for the v2 research (see PREREGISTRATION.md).
// Reads .cache/dataset.json (built by scripts/build-dataset.ts) — never the
// production DB. Monthly rebalance at month-end closes, equal weight, cost on
// turnover, unfilled slots in cash. All features are point-in-time: computed
// only from bars at or before the rebalance date.
import fs from "node:fs";
import path from "node:path";

export const BENCH = "13060";

export type Series = {
  code: string;
  name: string;
  sector: string | null;
  scale: string | null;
  market: string | null;
  t: string[];
  a: number[];
  c: number[];
  v: number[];
  divs?: [string, number][]; // ex-date, amount (split basis = close)
};

type Prepared = Series & { pre: Float64Array }; // prefix sums of adjClose

// Yahoo's long history (pre-2016) has unadjusted splits in ~5% of series —
// e.g. 1306's 10:1 split on 2015-01-05 shows as a −90% day, and many 1:100
// unit-share splits of 2004–06/2011–13. TSE daily price limits make a one-day
// move beyond ×0.6 / ×1.7 effectively impossible, so such a jump is a data
// break. The benchmark's known split is rescaled; for any other series the
// history BEFORE its last break is dropped (conservative: loses data, never
// invents it). Dividends before the cut are dropped with it.
const BREAK_LO = 0.6, BREAK_HI = 1.7;
export function repairBreaks(s: Series): Series {
  if (s.code === BENCH) {
    const k = s.t.indexOf("2015-01-05");
    if (k > 0 && s.a[k] / s.a[k - 1] < 0.2) {
      const a = s.a.map((x, i) => (i < k ? x / 10 : x));
      const c = s.c.map((x, i) => (i < k ? x / 10 : x));
      return { ...s, a, c };
    }
    return s;
  }
  let last = -1;
  for (let i = 1; i < s.a.length; i++) {
    const r = s.a[i] / s.a[i - 1];
    if (r < BREAK_LO || r > BREAK_HI) last = i;
  }
  if (last < 0) return s;
  const from = s.t[last];
  return {
    ...s,
    t: s.t.slice(last), a: s.a.slice(last), c: s.c.slice(last), v: s.v.slice(last),
    divs: s.divs?.filter(([d]) => d >= from),
  };
}

// Round-2 dataset: daily history from 2000 + dividends, one file per series.
export function loadLongDataset(): { stocks: Prepared[]; bench: Prepared; builtAt: string; extra: Map<string, Prepared> } {
  const dir = path.join(__dirname, "..", "..", ".cache", "long");
  const prep = (s: Series): Prepared => {
    const pre = new Float64Array(s.a.length + 1);
    for (let i = 0; i < s.a.length; i++) pre[i + 1] = pre[i] + s.a[i];
    return { ...s, pre };
  };
  const all = fs
    .readdirSync(dir)
    .map((f) => prep(repairBreaks(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Series)))
    .filter((s) => s.t.length >= 60);
  const bench = all.find((s) => s.code === BENCH)!;
  const extraCodes = new Set(["15700", "N225"]);
  return {
    stocks: all.filter((s) => s.code !== BENCH && !extraCodes.has(s.code)),
    bench,
    builtAt: fs.statSync(dir).mtime.toISOString(),
    extra: new Map(all.filter((s) => extraCodes.has(s.code)).map((s) => [s.code, s])),
  };
}

export function loadDataset(): { stocks: Prepared[]; bench: Prepared; builtAt: string } {
  const p = path.join(__dirname, "..", "..", ".cache", "dataset.json");
  const raw = JSON.parse(fs.readFileSync(p, "utf8")) as { builtAt: string; series: Series[] };
  const prep = (s: Series): Prepared => {
    const pre = new Float64Array(s.a.length + 1);
    for (let i = 0; i < s.a.length; i++) pre[i + 1] = pre[i] + s.a[i];
    return { ...s, pre };
  };
  const all = raw.series.map((s) => prep(repairBreaks(s))).filter((s) => s.t.length >= 60);
  const bench = all.find((s) => s.code === BENCH);
  if (!bench) throw new Error("benchmark missing from dataset");
  return { stocks: all.filter((s) => s.code !== BENCH), bench, builtAt: raw.builtAt };
}

function idxAtOrBefore(t: string[], d: string): number {
  let lo = 0, hi = t.length - 1, ans = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (t[m] <= d) { ans = m; lo = m + 1; } else hi = m - 1;
  }
  return ans;
}

const sma = (s: Prepared, end: number, n: number): number | null =>
  end - n + 1 < 0 ? null : (s.pre[end + 1] - s.pre[end + 1 - n]) / n;

export type Features = {
  code: string;
  sector: string | null;
  price: number;
  rsRaw: number;
  rsSkip: number | null;
  tt: boolean;
  vol60: number;
  vol120: number | null;
  turnover60: number;
  high52prox: number;
  ret36ex12: number | null;
  ret60ex12: number | null;
  dy: number | null; // trailing-12m dividend yield; null when no dividend data at all
};

// Point-in-time features at bar index i (requires i >= 252).
export function features(s: Prepared, i: number): Features | null {
  if (i < 252) return null;
  const a = s.a;
  const p = a[i];
  if (!(p > 0)) return null;
  const q = (k: number) => (a[i - k] > 0 ? p / a[i - k] : null);
  const q1 = q(63), q2 = q(126), q3 = q(189), q4 = q(252);
  if (q1 == null || q2 == null || q3 == null || q4 == null) return null;
  const rsRaw = (2 * q1 + q2 + q3 + q4) / 5;
  let rsSkip: number | null = null;
  if (i >= 273) {
    const j = i - 21, pj = a[j];
    const r = (k: number) => (a[j - k] > 0 ? pj / a[j - k] : null);
    const s1 = r(63), s2 = r(126), s3 = r(189), s4 = r(252 - 21);
    if (s1 && s2 && s3 && s4) rsSkip = (2 * s1 + s2 + s3 + s4) / 5;
  }

  const ma50 = sma(s, i, 50)!, ma150 = sma(s, i, 150)!, ma200 = sma(s, i, 200)!;
  const ma200prev = sma(s, i - 21, 200);
  let hi = -Infinity, lo = Infinity;
  for (let k = i - 251; k <= i; k++) { if (a[k] > hi) hi = a[k]; if (a[k] < lo) lo = a[k]; }
  const tt =
    p > ma150 && p > ma200 && ma150 > ma200 &&
    ma200prev != null && ma200 > ma200prev &&
    ma50 > ma150 && ma50 > ma200 && p > ma50 &&
    p >= lo * 1.3 && p >= hi * 0.75;

  const vol = (n: number): number | null => {
    if (i - n < 0) return null;
    let sum = 0, sum2 = 0;
    for (let k = i - n + 1; k <= i; k++) {
      const r = Math.log(a[k] / a[k - 1]);
      sum += r; sum2 += r * r;
    }
    const m = sum / n;
    return Math.sqrt(Math.max(0, sum2 / n - m * m)) * Math.sqrt(252);
  };
  let to = 0;
  for (let k = i - 59; k <= i; k++) to += s.c[k] * s.v[k];

  const lt = (L: number): number | null =>
    i - L >= 0 && a[i - L] > 0 ? a[i - 252] / a[i - L] : null;

  let dy: number | null = null;
  if (s.divs) {
    const asOf = s.t[i];
    const from = shiftDays(asOf, -365);
    let sum = 0;
    for (const [d, amt] of s.divs) if (d > from && d <= asOf) sum += amt;
    dy = s.c[i] > 0 ? sum / s.c[i] : null;
  }

  return {
    dy,
    code: s.code,
    sector: s.sector,
    price: p,
    rsRaw,
    rsSkip,
    tt,
    vol60: vol(60) ?? 1,
    vol120: vol(120),
    turnover60: to / 60,
    high52prox: p / hi,
    ret36ex12: lt(756),
    ret60ex12: lt(1260),
  };
}

export type Params = {
  label: string;
  topN: number;
  costBps: number;
  requireTT: boolean;
  // HIGHER is better. Either a per-stock score, or a cross-sectional scorer
  // run once per month over the eligible pool (for rank composites).
  score?: (f: Features) => number | null;
  scoreAll?: (pool: Features[]) => Map<string, number>;
  filter?: (f: Features) => boolean;
  maxPerSector?: number;
  // Hold stocks only when the benchmark's month-end close is above its
  // N-month SMA (Faber). Otherwise everything goes to cash for that month.
  indexTrendMonths?: number;
  // Debug hook: called once per month with each holding's return.
  onMonth?: (d0: string, holdings: { code: string; ret: number }[]) => void;
};

export type MonthRow = { d0: string; d1: string; strat: number; bench: number; held: number; inMarket: boolean };

export function monthEnds(bench: Prepared): string[] {
  const out: string[] = [];
  for (let i = 0; i < bench.t.length; i++) {
    if (i === bench.t.length - 1 || bench.t[i].slice(0, 7) !== bench.t[i + 1].slice(0, 7)) out.push(bench.t[i]);
  }
  return out;
}

// Rank helper: returns map code → percentile (0..1, higher = better value).
export function pctRank(items: { code: string; v: number }[]): Map<string, number> {
  const sorted = [...items].sort((x, y) => x.v - y.v);
  const n = sorted.length;
  const m = new Map<string, number>();
  sorted.forEach((it, k) => m.set(it.code, n > 1 ? k / (n - 1) : 1));
  return m;
}

export function run(
  ds: ReturnType<typeof loadDataset>,
  P: Params,
  window: { from?: string; to?: string } = {},
): MonthRow[] {
  const ends = monthEnds(ds.bench);
  const benchMonthEndIdx = ends.map((d) => idxAtOrBefore(ds.bench.t, d));
  const rows: MonthRow[] = [];
  let held = new Set<string>();
  const cost = P.costBps / 10000;

  for (let m = 0; m < ends.length - 1; m++) {
    const d0 = ends[m], d1 = ends[m + 1];
    if (window.from && d0 < window.from) continue;
    if (window.to && d1 > window.to) break;

    const b0 = ds.bench.a[benchMonthEndIdx[m]], b1 = ds.bench.a[benchMonthEndIdx[m + 1]];
    const benchRet = b1 / b0 - 1;

    // Universe features at d0.
    const feats: Features[] = [];
    const idx0 = new Map<string, number>();
    for (const s of ds.stocks) {
      const i = idxAtOrBefore(s.t, d0);
      if (i < 0 || s.t[i] < shiftDays(d0, -10)) continue; // no recent bar → not tradeable
      const f = features(s, i);
      if (!f) continue;
      feats.push(f);
      idx0.set(s.code, i);
    }
    if (feats.length < 50) continue; // not enough history yet

    let inMarket = true;
    if (P.indexTrendMonths) {
      const k = P.indexTrendMonths;
      if (m - k + 1 < 0) continue;
      let sum = 0;
      for (let j = m - k + 1; j <= m; j++) sum += ds.bench.a[benchMonthEndIdx[j]];
      inMarket = b0 > sum / k;
    }

    let selection: string[] = [];
    if (inMarket) {
      const pool = feats.filter((f) => (!P.requireTT || f.tt) && (!P.filter || P.filter(f)));
      const all = P.scoreAll ? P.scoreAll(pool) : null;
      const scored = pool
        .map((f) => ({ f, s: all ? (all.get(f.code) ?? null) : P.score!(f) }))
        .filter((x): x is { f: Features; s: number } => x.s != null && Number.isFinite(x.s))
        .sort((x, y) => y.s - x.s);
      const perSector = new Map<string, number>();
      for (const x of scored) {
        if (selection.length >= P.topN) break;
        if (P.maxPerSector && x.f.sector) {
          const u = perSector.get(x.f.sector) ?? 0;
          if (u >= P.maxPerSector) continue;
          perSector.set(x.f.sector, u + 1);
        }
        selection.push(x.f.code);
      }
    }

    const sel = new Set(selection);
    const entries = selection.filter((c) => !held.has(c)).length;
    const exits = [...held].filter((c) => !sel.has(c)).length;
    const turnover = (entries + exits) / P.topN;

    let sum = 0;
    const dbg: { code: string; ret: number }[] = [];
    for (const code of selection) {
      const s = ds.stocks.find((x) => x.code === code)!;
      const i0 = idx0.get(code)!;
      const i1 = idxAtOrBefore(s.t, d1);
      const r = i1 > i0 ? s.a[i1] / s.a[i0] - 1 : 0;
      sum += r;
      dbg.push({ code, ret: r });
    }
    P.onMonth?.(d0, dbg);
    const strat = sum / P.topN - turnover * cost;
    rows.push({ d0, d1, strat, bench: benchRet, held: selection.length, inMarket });
    held = sel;
  }
  return rows;
}

function shiftDays(d: string, n: number): string {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

export type Stats = {
  months: number; cagr: number; benchCagr: number; maxDD: number; benchMaxDD: number;
  winVsBench: number; absWin: number; avgUp: number; avgDown: number; avgHeld: number; vol: number;
};

export function stats(rows: MonthRow[]): Stats {
  const n = rows.length;
  let e = 1, be = 1, peak = 1, bpeak = 1, dd = 0, bdd = 0;
  let up = 0, upSum = 0, downSum = 0, wins = 0, held = 0, s1 = 0, s2 = 0;
  for (const r of rows) {
    e *= 1 + r.strat; be *= 1 + r.bench;
    peak = Math.max(peak, e); bpeak = Math.max(bpeak, be);
    dd = Math.min(dd, e / peak - 1); bdd = Math.min(bdd, be / bpeak - 1);
    if (r.strat > 0) { up++; upSum += r.strat; } else downSum += r.strat;
    if (r.strat > r.bench) wins++;
    held += r.held; s1 += r.strat; s2 += r.strat * r.strat;
  }
  const mean = s1 / n;
  return {
    months: n,
    cagr: Math.pow(e, 12 / n) - 1,
    benchCagr: Math.pow(be, 12 / n) - 1,
    maxDD: dd, benchMaxDD: bdd,
    winVsBench: wins / n, absWin: up / n,
    avgUp: up ? upSum / up : 0, avgDown: n - up ? downSum / (n - up) : 0,
    avgHeld: held / n,
    vol: Math.sqrt(Math.max(0, s2 / n - mean * mean)) * Math.sqrt(12),
  };
}

export const pct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
