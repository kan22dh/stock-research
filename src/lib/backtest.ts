// Monthly-rebalanced momentum backtest over PriceCache (Yahoo-sourced 5y bars).
//
// Strategy: at each month-end, rank the universe by point-in-time rsRaw
// (computed ONLY from bars up to that date — no look-ahead), optionally
// require the 7-condition Trend Template to pass, hold the top N equal-weight
// for one month. Unfilled slots stay in cash (this is what makes the strategy
// go defensive in bear markets, mirroring CAN SLIM's "M" condition).
//
// Honest-accounting notes (also surfaced in the UI):
// - Universe = currently-listed stocks we hold financials for → survivorship
//   bias inflates results somewhat (delisted losers are absent).
// - Cost model: costPerSideBps applied to turnover both ways.
// - Monthly close-to-close fills; no slippage beyond the cost setting.

import { prisma } from "./db";
import { computeMomentumMetrics } from "./momentum";

export const BENCHMARK_CODE = "13060"; // TOPIX連動ETF (1306)

export type BacktestParams = {
  topN: number;
  requireTrendTemplate: boolean;
  costPerSideBps: number; // 10 = 0.1% per side
  // Minervini/O'Neil-style stop: sell intra-month when a holding closes this %
  // below its month-start price; proceeds sit in cash until next rebalance.
  // 0 = no stop. This is the champions' core discipline — without it a single
  // -60% blowup (e.g. 7692 in 2023-04) rides all the way down.
  stopLossPct: number;
};

export type BacktestPoint = { time: string; strategy: number; benchmark: number };

export type BacktestResult = {
  points: BacktestPoint[];
  months: number;
  cagr: number;
  benchCagr: number;
  maxDrawdown: number;
  benchMaxDrawdown: number;
  monthlyWinRate: number; // share of months beating the benchmark
  yearly: { year: string; strategy: number; benchmark: number }[];
  avgHoldings: number;
  universeSize: number;
  params: BacktestParams;
};

type Series = { dates: string[]; closes: number[] };

// Yahoo occasionally ships corrupt bars (e.g. 1306.T on 2026-03-30/31 shows
// ¥37 instead of ¥376 — a dropped digit). Remove bars deviating >40% from the
// centered 11-bar median: a genuine crash persists in neighboring bars so the
// median follows it and the bar survives; a 1-3 bar glitch gets dropped.
function cleanSeries(s: Series): Series {
  const n = s.closes.length;
  if (n < 15) return s;
  const dates: string[] = [];
  const closes: number[] = [];
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - 5);
    const hi = Math.min(n, i + 6);
    const window = s.closes.slice(lo, hi).sort((a, b) => a - b);
    const median = window[Math.floor(window.length / 2)];
    if (median > 0 && Math.abs(s.closes[i] / median - 1) > 0.4) continue;
    dates.push(s.dates[i]);
    closes.push(s.closes[i]);
  }
  return { dates, closes };
}

// Load close series for the whole universe + benchmark.
// Prefers adjClose (split+dividend adjusted) so strategy vs benchmark is a
// fair TOTAL-return comparison — raw close ignores dividends, understating
// the TOPIX ETF (~2%/yr distributions) and any dividend-paying holdings.
// Aggregated to one row per code in Postgres: 10y × 1,200 stocks is ~3M bars,
// which as individual Prisma rows would blow past serverless memory/time.
export async function loadBacktestData(): Promise<{
  byCode: Map<string, Series>;
  benchmark: Series | null;
}> {
  const rows = await prisma.$queryRaw<
    { code: string; dates: string[]; closes: number[] }[]
  >`
    SELECT code,
           array_agg(to_char(date, 'YYYY-MM-DD') ORDER BY date) AS dates,
           (array_agg(COALESCE("adjClose", close) ORDER BY date))::float8[] AS closes
    FROM "PriceCache"
    GROUP BY code
  `;
  const byCode = new Map<string, Series>();
  for (const r of rows) {
    byCode.set(r.code, cleanSeries({ dates: r.dates, closes: r.closes }));
  }
  const benchmark = byCode.get(BENCHMARK_CODE) ?? null;
  byCode.delete(BENCHMARK_CODE);
  return { byCode, benchmark };
}

// Index of the last date <= target (binary search), or -1.
function lastIndexAtOrBefore(dates: string[], target: string): number {
  let lo = 0;
  let hi = dates.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= target) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

// Last trading day of each calendar month in the benchmark series.
function monthEnds(benchDates: string[]): string[] {
  const ends: string[] = [];
  for (let i = 0; i < benchDates.length; i++) {
    const isLast =
      i === benchDates.length - 1 ||
      benchDates[i].slice(0, 7) !== benchDates[i + 1].slice(0, 7);
    if (isLast) ends.push(benchDates[i]);
  }
  return ends;
}

export function runBacktest(
  byCode: Map<string, Series>,
  benchmark: Series,
  params: BacktestParams,
): BacktestResult | null {
  const rebalances = monthEnds(benchmark.dates);
  // Need ~13 months of history before the first tradeable month-end so that
  // 12-month RS is computable for at least part of the universe.
  const MIN_HISTORY_BARS = 253;
  const startIdx = rebalances.findIndex((d) => {
    let ready = 0;
    for (const s of byCode.values()) {
      const idx = lastIndexAtOrBefore(s.dates, d);
      if (idx + 1 >= MIN_HISTORY_BARS) ready++;
      if (ready >= 10) return true;
    }
    return false;
  });
  if (startIdx < 0 || rebalances.length - startIdx < 8) return null;

  const cost = params.costPerSideBps / 10000;
  let equity = 100;
  let benchEquity = 100;
  const points: BacktestPoint[] = [];
  let held = new Set<string>();
  let winMonths = 0;
  let totalHoldings = 0;
  const yearlyAgg = new Map<string, { s: number; b: number }>();

  const benchCloseAt = (d: string): number | null => {
    const i = lastIndexAtOrBefore(benchmark.dates, d);
    return i >= 0 ? benchmark.closes[i] : null;
  };

  points.push({ time: rebalances[startIdx], strategy: equity, benchmark: benchEquity });

  for (let i = startIdx; i < rebalances.length - 1; i++) {
    const t0 = rebalances[i];
    const t1 = rebalances[i + 1];

    // Rank point-in-time.
    const candidates: { code: string; rsRaw: number }[] = [];
    for (const [code, s] of byCode) {
      const idx = lastIndexAtOrBefore(s.dates, t0);
      if (idx + 1 < MIN_HISTORY_BARS) continue;
      const m = computeMomentumMetrics(
        s.closes.slice(0, idx + 1).map((close) => ({ close })),
      );
      if (!m || m.rsRaw == null) continue;
      if (params.requireTrendTemplate && !m.technicalPass) continue;
      candidates.push({ code, rsRaw: m.rsRaw });
    }
    candidates.sort((a, b) => b.rsRaw - a.rsRaw);
    const selection = new Set(candidates.slice(0, params.topN).map((c) => c.code));

    // Turnover cost: pay both sides on changed slots (and full buy on month 1).
    const entries = [...selection].filter((c) => !held.has(c)).length;
    const turnoverFrac =
      held.size === 0
        ? selection.size / params.topN
        : (entries / params.topN) * 2;
    equity *= 1 - turnoverFrac * cost;
    held = selection;
    totalHoldings += selection.size;

    // One-month return, equal weight 1/topN per slot; empty slots are cash.
    // With a stop set, walk the daily closes inside the month and bail at the
    // first close at/below the stop (fill approximated at that close).
    const stop = params.stopLossPct > 0 ? params.stopLossPct / 100 : null;
    let sumReturns = 0;
    for (const code of selection) {
      const s = byCode.get(code)!;
      const i0 = lastIndexAtOrBefore(s.dates, t0);
      const i1 = lastIndexAtOrBefore(s.dates, t1);
      if (i0 < 0 || i1 <= i0) continue;
      const entry = s.closes[i0];
      let r = s.closes[i1] / entry - 1;
      if (stop != null) {
        for (let j = i0 + 1; j <= i1; j++) {
          if (s.closes[j] <= entry * (1 - stop)) {
            r = s.closes[j] / entry - 1; // stopped out; extra sell side cost
            r -= cost;
            break;
          }
        }
      }
      sumReturns += r;
    }
    const stratReturn = sumReturns / params.topN;

    const b0 = benchCloseAt(t0);
    const b1 = benchCloseAt(t1);
    const benchReturn = b0 != null && b1 != null && b0 !== 0 ? b1 / b0 - 1 : 0;

    equity *= 1 + stratReturn;
    benchEquity *= 1 + benchReturn;
    if (stratReturn > benchReturn) winMonths++;

    const year = t1.slice(0, 4);
    const y = yearlyAgg.get(year) ?? { s: 1, b: 1 };
    y.s *= 1 + stratReturn;
    y.b *= 1 + benchReturn;
    yearlyAgg.set(year, y);

    points.push({ time: t1, strategy: equity, benchmark: benchEquity });
  }

  const months = points.length - 1;
  if (months < 6) return null;

  const maxDD = (vals: number[]): number => {
    let peak = -Infinity;
    let dd = 0;
    for (const v of vals) {
      peak = Math.max(peak, v);
      dd = Math.min(dd, v / peak - 1);
    }
    return dd;
  };

  return {
    points,
    months,
    cagr: Math.pow(equity / 100, 12 / months) - 1,
    benchCagr: Math.pow(benchEquity / 100, 12 / months) - 1,
    maxDrawdown: maxDD(points.map((p) => p.strategy)),
    benchMaxDrawdown: maxDD(points.map((p) => p.benchmark)),
    monthlyWinRate: winMonths / months,
    yearly: [...yearlyAgg.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([year, v]) => ({ year, strategy: v.s - 1, benchmark: v.b - 1 })),
    avgHoldings: totalHoldings / months,
    universeSize: byCode.size,
    params,
  };
}
