// Price/dividend data + features for the v2 guard account. Mirrors, line for
// line, what the research simulator does with the round-3 dataset:
//   scripts/research/build-long2.ts  → fetch (JST dates, validBarIndices)
//   scripts/research/sim-guard.ts    → break trim on close/open/adjClose
//   scripts/research/engine.ts       → features(): rsRaw, Trend Template, dy
// scripts/research/parity-guard.ts checks that both sides pick the same
// targets on cached data. Change one side → change the other and re-run it.

import { validBarIndices } from "./momentum";

export type GuardBars = {
  t: string[]; // JST trading dates
  o: number[];
  c: number[];
  a: number[]; // adjClose (split + dividend) — momentum / Trend Template
  v: number[];
  divs: [string, number][]; // ex-date, amount (same split basis as c)
};

const UA = "Mozilla/5.0 (compatible; stock-research-dashboard)";

function yahooSymbol(code: string): string {
  return `${code.trim().toUpperCase().slice(0, 4)}.T`;
}

export async function fetchGuardBars(code: string, range: "1mo" | "3mo" | "2y"): Promise<GuardBars | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(code))}?interval=1d&range=${range}&events=div`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as {
        chart?: { result?: Array<{
          timestamp?: number[];
          events?: { dividends?: Record<string, { date: number; amount: number }> };
          indicators: {
            quote: Array<{ open: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }>;
            adjclose?: Array<{ adjclose: (number | null)[] }>;
          };
        }> };
      };
      const r = j.chart?.result?.[0];
      if (!r?.timestamp) return null;
      const q = r.indicators.quote[0];
      const adj = r.indicators.adjclose?.[0]?.adjclose;
      const t: string[] = [], o: number[] = [], c: number[] = [], a: number[] = [], v: number[] = [];
      r.timestamp.forEach((ts, k) => {
        const close = q.close[k];
        if (close == null || !(close > 0)) return;
        t.push(new Date((ts + 9 * 3600) * 1000).toISOString().slice(0, 10));
        c.push(close);
        o.push(q.open[k] ?? close);
        a.push(adj?.[k] ?? close);
        v.push(q.volume[k] ?? 0);
      });
      const keep = validBarIndices(c);
      const divs = Object.values(r.events?.dividends ?? {})
        .map((d) => [new Date((d.date + 9 * 3600) * 1000).toISOString().slice(0, 10), d.amount] as [string, number])
        .sort((x, y) => x[0].localeCompare(y[0]));
      return trimBreaks({
        t: keep.map((k) => t[k]),
        o: keep.map((k) => o[k]),
        c: keep.map((k) => c[k]),
        a: keep.map((k) => a[k]),
        v: keep.map((k) => v[k]),
        divs,
      });
    } catch {
      await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
    }
  }
  return null;
}

// One-day moves beyond ×0.6 / ×1.7 (close, open vs previous close, adjClose)
// are impossible under TSE price limits → unadjusted split / stitched
// listing. Drop history before the last one (same rule as sim-guard.ts).
export function trimBreaks(b: GuardBars): GuardBars {
  const LO = 0.6, HI = 1.7;
  let last = -1;
  for (let i = 1; i < b.c.length; i++) {
    const rc = b.c[i] / b.c[i - 1], ro = b.o[i] / b.c[i - 1], ra = b.a[i] / b.a[i - 1];
    if (rc < LO || rc > HI || ro < LO || ro > HI || ra < LO || ra > HI) last = i;
  }
  if (last <= 0) return b;
  const from = b.t[last];
  return {
    t: b.t.slice(last), o: b.o.slice(last), c: b.c.slice(last), a: b.a.slice(last), v: b.v.slice(last),
    divs: b.divs.filter(([d]) => d >= from),
  };
}

function shiftDays(d: string, n: number): string {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

// Features at the LAST bar — identical arithmetic to engine.features().
export function guardFeatures(b: GuardBars): { rsRaw: number; tt: boolean; dy: number | null } | null {
  const i = b.a.length - 1;
  if (i < 252) return null;
  const a = b.a;
  const p = a[i];
  if (!(p > 0)) return null;
  const q = (k: number) => (a[i - k] > 0 ? p / a[i - k] : null);
  const q1 = q(63), q2 = q(126), q3 = q(189), q4 = q(252);
  if (q1 == null || q2 == null || q3 == null || q4 == null) return null;
  const rsRaw = (2 * q1 + q2 + q3 + q4) / 5;

  const sma = (end: number, n: number): number | null => {
    if (end - n + 1 < 0) return null;
    let s = 0;
    for (let k = end - n + 1; k <= end; k++) s += a[k];
    return s / n;
  };
  const ma50 = sma(i, 50)!, ma150 = sma(i, 150)!, ma200 = sma(i, 200)!;
  const ma200prev = sma(i - 21, 200);
  let hi = -Infinity, lo = Infinity;
  for (let k = i - 251; k <= i; k++) { if (a[k] > hi) hi = a[k]; if (a[k] < lo) lo = a[k]; }
  const tt =
    p > ma150 && p > ma200 && ma150 > ma200 &&
    ma200prev != null && ma200 > ma200prev &&
    ma50 > ma150 && ma50 > ma200 && p > ma50 &&
    p >= lo * 1.3 && p >= hi * 0.75;

  const asOf = b.t[i];
  const from = shiftDays(asOf, -365);
  let sum = 0;
  for (const [d, amt] of b.divs) if (d > from && d <= asOf) sum += amt;
  const dy = b.c[i] > 0 ? sum / b.c[i] : null;
  return { rsRaw, tt, dy };
}

// Small concurrency pool for the monthly universe pass.
export async function mapPool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (cursor < items.length) {
        const k = cursor++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}
