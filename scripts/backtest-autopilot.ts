// Event-driven daily backtest of the EXACT paper-autopilot rules
// (lib/paper-autopilot.ts) over the 10y PriceCache universe:
//
//   Entry:  day t-1 was a VCP setup; day t close > pivot(t-1) (10d high);
//           TT technical pass + RS rating >= 70 (universe percentile that day);
//           market filter: benchmark close > its 50d MA; max 8 positions;
//           1% risk / 8% stop sizing, fractional shares, cash-capped;
//           fill at day t close (autopilot fills at next-morning observed price
//           = that same close, so this mirrors it).
//   Exit:   close <= stop -> sell at that close. Stop trails to high×0.92
//           once price reaches entry×1.10 (never lowered).
//
// Honest notes: survivorship bias (current listings only); fills at close
// ignore gaps' intraday severity (a gap through the stop fills at the gapped
// close — which DOES capture gap losses); no taxes; S株 assumed (no lot size).
//
// Run: npx tsx scripts/backtest-autopilot.ts

import { prisma } from "../src/lib/db";
import { validBarIndices } from "../src/lib/momentum";

const BENCHMARK = "13060";
const START_CASH = 600_000;
const MAX_POS = 8;
const RISK = 0.01;
const STOP = 0.08;
const TRAIL_TRIGGER = 1.1;
const TRAIL_FACTOR = 0.92;
const RS_MIN = 70;

type Stock = {
  code: string;
  dates: string[]; // ascending
  close: Float64Array; // adjusted
  high: Float64Array; // adjusted (scaled by adjClose/close)
  low: Float64Array;
  volume: Float64Array;
  // Per-day precomputed
  ma50: Float64Array;
  ma150: Float64Array;
  ma200: Float64Array;
  hi252: Float64Array;
  lo252: Float64Array;
  hi10: Float64Array;
  lo10: Float64Array;
  hi30: Float64Array;
  lo30: Float64Array;
  vol10: Float64Array;
  vol50: Float64Array;
  rsRaw: Float64Array; // NaN when insufficient history
  ttPass: Uint8Array;
  vcpPass: Uint8Array;
  dateIndex: Map<string, number>;
};

function rollingMean(src: Float64Array, win: number): Float64Array {
  const out = new Float64Array(src.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    sum += src[i];
    if (i >= win) sum -= src[i - win];
    if (i >= win - 1) out[i] = sum / win;
  }
  return out;
}

// Sliding-window max/min via monotonic deque, O(n).
function rollingExtreme(
  src: Float64Array,
  win: number,
  kind: "max" | "min",
): Float64Array {
  const out = new Float64Array(src.length).fill(NaN);
  const dq: number[] = [];
  const better = (a: number, b: number) => (kind === "max" ? a >= b : a <= b);
  for (let i = 0; i < src.length; i++) {
    while (dq.length && dq[0] <= i - win) dq.shift();
    while (dq.length && better(src[i], src[dq[dq.length - 1]])) dq.pop();
    dq.push(i);
    if (i >= win - 1) out[i] = src[dq[0]];
  }
  return out;
}

function prepare(code: string, rows: { d: string; c: number; a: number | null; h: number; l: number; v: number }[]): Stock | null {
  // Glitch-filter on raw closes, then scale OHLC to the adjusted series.
  const kept = validBarIndices(rows.map((r) => r.c));
  if (kept.length < 260) return null;
  const n = kept.length;
  const dates: string[] = new Array(n);
  const close = new Float64Array(n);
  const high = new Float64Array(n);
  const low = new Float64Array(n);
  const volume = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = rows[kept[i]];
    const adj = r.a ?? r.c;
    const f = adj / r.c;
    dates[i] = r.d;
    close[i] = adj;
    high[i] = r.h * f;
    low[i] = r.l * f;
    volume[i] = r.v;
  }

  const ma50 = rollingMean(close, 50);
  const ma150 = rollingMean(close, 150);
  const ma200 = rollingMean(close, 200);
  const hi252 = rollingExtreme(high, 252, "max");
  const lo252 = rollingExtreme(low, 252, "min");
  const hi10 = rollingExtreme(high, 10, "max");
  const lo10 = rollingExtreme(low, 10, "min");
  const hi30 = rollingExtreme(high, 30, "max");
  const lo30 = rollingExtreme(low, 30, "min");
  const vol10 = rollingMean(volume, 10);
  const vol50 = rollingMean(volume, 50);

  const rsRaw = new Float64Array(n).fill(NaN);
  const ttPass = new Uint8Array(n);
  const vcpPass = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = close[i];
    if (i >= 252) {
      const q1 = p / close[i - 63];
      const q2 = p / close[i - 126];
      const q3 = p / close[i - 189];
      const q4 = p / close[i - 252];
      rsRaw[i] = (2 * q1 + q2 + q3 + q4) / 5;
    }
    if (i >= 220) {
      const tt =
        p > ma150[i] &&
        p > ma200[i] &&
        ma150[i] > ma200[i] &&
        ma200[i] > ma200[i - 21] &&
        ma50[i] > ma150[i] &&
        ma50[i] > ma200[i] &&
        p > ma50[i] &&
        p >= lo252[i] * 1.3 &&
        p >= hi252[i] * 0.75;
      ttPass[i] = tt ? 1 : 0;
      const r10 = (hi10[i] - lo10[i]) / p;
      const r30 = (hi30[i] - lo30[i]) / p;
      const vcp =
        r10 <= 0.1 &&
        r30 > 0 &&
        r10 <= r30 * 0.6 &&
        vol50[i] > 0 &&
        vol10[i] <= vol50[i] * 0.85 &&
        hi252[i] > 0 &&
        p >= hi252[i] * 0.85;
      vcpPass[i] = vcp ? 1 : 0;
    }
  }

  const dateIndex = new Map<string, number>();
  for (let i = 0; i < n; i++) dateIndex.set(dates[i], i);
  return { code, dates, close, high, low, volume, ma50, ma150, ma200, hi252, lo252, hi10, lo10, hi30, lo30, vol10, vol50, rsRaw, ttPass, vcpPass, dateIndex };
}

async function main() {
  console.log("loading bars...");
  const t0 = Date.now();
  const rows = await prisma.$queryRaw<
    { code: string; d: string[]; c: number[]; a: (number | null)[]; h: number[]; l: number[]; v: number[] }[]
  >`
    SELECT code,
           array_agg(to_char(date,'YYYY-MM-DD') ORDER BY date) AS d,
           (array_agg(close ORDER BY date))::float8[] AS c,
           array_agg("adjClose" ORDER BY date) AS a,
           (array_agg(high ORDER BY date))::float8[] AS h,
           (array_agg(low ORDER BY date))::float8[] AS l,
           (array_agg(volume ORDER BY date))::float8[] AS v
    FROM "PriceCache" GROUP BY code
  `;
  console.log(`loaded ${rows.length} codes in ${((Date.now() - t0) / 1000).toFixed(1)}s; preparing...`);

  let bench: Stock | null = null;
  const stocks: Stock[] = [];
  for (const r of rows) {
    const s = prepare(
      r.code,
      r.d.map((d, i) => ({ d, c: r.c[i], a: r.a[i], h: r.h[i], l: r.l[i], v: r.v[i] })),
    );
    if (!s) continue;
    if (s.code === BENCHMARK) bench = s;
    else stocks.push(s);
  }
  if (!bench) throw new Error("no benchmark");
  console.log(`prepared ${stocks.length} stocks + benchmark in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // Simulate over the benchmark calendar.
  type Pos = { s: Stock; shares: number; entry: number; stop: number; high: number; entryDate: string };
  let cash = START_CASH;
  const positions = new Map<string, Pos>();
  const equityCurve: { date: string; equity: number }[] = [];
  let trades = 0;
  let wins = 0;
  let sumWin = 0;
  let sumLoss = 0;
  let benchStartIdx = -1;

  for (let bi = 253; bi < bench.dates.length; bi++) {
    const date = bench.dates[bi];

    // 1) Exits.
    for (const [code, p] of [...positions]) {
      const i = p.s.dateIndex.get(date);
      if (i == null) continue;
      const price = p.s.close[i];
      if (price <= p.stop) {
        cash += price * p.shares;
        const pnl = (price - p.entry) * p.shares;
        trades++;
        if (pnl > 0) {
          wins++;
          sumWin += pnl;
        } else sumLoss += -pnl;
        positions.delete(code);
        continue;
      }
      const newHigh = Math.max(p.high, price);
      if (newHigh >= p.entry * TRAIL_TRIGGER) {
        p.stop = Math.max(p.stop, newHigh * TRAIL_FACTOR);
      }
      p.high = newHigh;
    }

    // 2) Market filter for entries.
    const mOK = bench.close[bi] > bench.ma50[bi];

    // 3) Entries: breakout = yesterday VCP setup, today close > yesterday's 10d high.
    if (mOK && positions.size < MAX_POS) {
      // Universe RS percentile today.
      const rsVals: number[] = [];
      const candidates: { s: Stock; i: number; rs: number }[] = [];
      for (const s of stocks) {
        const i = s.dateIndex.get(date);
        if (i == null || i < 253) continue;
        const rs = s.rsRaw[i];
        if (!Number.isNaN(rs)) rsVals.push(rs);
        if (positions.has(s.code)) continue;
        if (!s.vcpPass[i - 1]) continue;
        if (s.close[i] <= s.hi10[i - 1]) continue; // no breakout
        if (!s.ttPass[i]) continue;
        candidates.push({ s, i, rs });
      }
      if (candidates.length > 0) {
        rsVals.sort((a, b) => a - b);
        const pctile = (v: number) => {
          // binary search rank
          let lo = 0,
            hi = rsVals.length;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (rsVals[mid] <= v) lo = mid + 1;
            else hi = mid;
          }
          return rsVals.length > 1 ? (lo - 1) / (rsVals.length - 1) : 1;
        };
        const strong = candidates
          .filter((c) => !Number.isNaN(c.rs) && pctile(c.rs) * 98 + 1 >= RS_MIN)
          .sort((a, b) => b.rs - a.rs);
        for (const c of strong) {
          if (positions.size >= MAX_POS) break;
          let equity = cash;
          for (const [, p] of positions) {
            const pi = p.s.dateIndex.get(date);
            equity += (pi != null ? p.s.close[pi] : p.entry) * p.shares;
          }
          const target = Math.min((equity * RISK) / STOP, cash);
          const price = c.s.close[c.i];
          const shares = Math.floor(target / price);
          if (shares < 1) continue;
          cash -= shares * price;
          positions.set(c.s.code, {
            s: c.s,
            shares,
            entry: price,
            stop: price * (1 - STOP),
            high: price,
            entryDate: date,
          });
        }
      }
    }

    // 4) Mark equity.
    let equity = cash;
    for (const [, p] of positions) {
      const i = p.s.dateIndex.get(date);
      equity += (i != null ? p.s.close[i] : p.entry) * p.shares;
    }
    equityCurve.push({ date, equity });
    if (benchStartIdx < 0) benchStartIdx = bi;
  }

  // Stats.
  const first = equityCurve[0];
  const last = equityCurve[equityCurve.length - 1];
  const years = equityCurve.length / 244;
  const cagr = Math.pow(last.equity / START_CASH, 1 / years) - 1;
  let peak = -Infinity;
  let maxDD = 0;
  for (const p of equityCurve) {
    peak = Math.max(peak, p.equity);
    maxDD = Math.min(maxDD, p.equity / peak - 1);
  }
  const bStart = bench.close[benchStartIdx];
  const bEnd = bench.close[bench.dates.length - 1];
  const bCagr = Math.pow(bEnd / bStart, 1 / years) - 1;
  let bPeak = -Infinity;
  let bDD = 0;
  for (let i = benchStartIdx; i < bench.dates.length; i++) {
    bPeak = Math.max(bPeak, bench.close[i]);
    bDD = Math.min(bDD, bench.close[i] / bPeak - 1);
  }

  console.log(`\n=== 自動運用ルールの10年日次バックテスト (${first.date}〜${last.date}) ===`);
  console.log(`最終資産: ${Math.round(last.equity).toLocaleString()}円 (開始${START_CASH.toLocaleString()}円)`);
  console.log(`年率: ${(cagr * 100).toFixed(1)}% / ベンチ(TOPIX ETF): ${(bCagr * 100).toFixed(1)}%`);
  console.log(`最大DD: ${(maxDD * 100).toFixed(1)}% / ベンチ: ${(bDD * 100).toFixed(1)}%`);
  console.log(`決済トレード数: ${trades} / 勝ち: ${wins} (勝率${trades > 0 ? ((wins / trades) * 100).toFixed(0) : "—"}%)`);
  if (wins > 0 && trades - wins > 0) {
    console.log(`平均利益: ${Math.round(sumWin / wins).toLocaleString()}円 / 平均損失: ${Math.round(sumLoss / (trades - wins)).toLocaleString()}円`);
    console.log(`ペイオフレシオ: ${(sumWin / wins / (sumLoss / (trades - wins))).toFixed(2)}`);
  }
  const openPnl = [...positions.values()];
  console.log(`保有中: ${openPnl.length}銘柄`);

  // Yearly returns.
  const byYear = new Map<string, { s: number; e: number }>();
  for (const p of equityCurve) {
    const y = p.date.slice(0, 4);
    const cur = byYear.get(y);
    if (!cur) byYear.set(y, { s: p.equity, e: p.equity });
    else cur.e = p.equity;
  }
  console.log("\n年次: ");
  let prevEnd: number | null = null;
  for (const [y, v] of [...byYear.entries()].sort()) {
    const base = prevEnd ?? v.s;
    console.log(`  ${y}: ${(((v.e - base) / base) * 100).toFixed(1)}%`);
    prevEnd = v.e;
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
