// Price-momentum metrics: RS Rating raw score + Minervini Trend Template.
// Source data: Yahoo Finance daily close series (see yahoo-finance.ts).
//
// RS Rating (relative strength) approximates IBD's proprietary formula, which
// is not public. The commonly-used replication weights the most recent
// quarter double: rsRaw = (2*Q1 + Q2 + Q3 + Q4) / 5, where Qn = price(now) /
// price(n*3 months ago). rsRaw is a raw ratio, not yet percentile-ranked —
// call computeRSRatings() across the full universe to get the 1-99 rating.
//
// Trend Template (Minervini) has 8 conditions; the 8th ("RS Rating >= 70") is
// universe-relative and can't be computed for a single stock in isolation, so
// this module only scores the 7 purely-technical conditions (technicalScore
// 0-7 / technicalPass). Combine with the live RS Rating at read-time for the
// full 8-point pass/fail.

const TRADING_DAYS_PER_MONTH = 21;

export type TrendTemplateCondition = { label: string; pass: boolean };

export type MomentumMetrics = {
  price: number;
  return1m: number | null;
  return3m: number | null;
  return6m: number | null;
  return9m: number | null;
  return12m: number | null;
  rsRaw: number | null;
  ma50: number | null;
  ma150: number | null;
  ma200: number | null;
  high52w: number;
  low52w: number;
  technicalScore: number; // 0-7
  technicalPass: boolean; // all 7
  conditions: TrendTemplateCondition[];
};

export function computeMomentumMetrics(
  bars: { close: number }[],
): MomentumMetrics | null {
  if (bars.length < 60) return null;
  const closes = bars.map((b) => b.close);
  const n = closes.length;
  const price = closes[n - 1];
  if (!Number.isFinite(price) || price <= 0) return null;

  const closeMonthsAgo = (months: number): number | null => {
    const idx = n - 1 - months * TRADING_DAYS_PER_MONTH;
    if (idx < 0) return null;
    return closes[idx];
  };
  const returnPct = (months: number): number | null => {
    const past = closeMonthsAgo(months);
    if (past == null || past === 0) return null;
    return ((price - past) / past) * 100;
  };
  const ratio = (months: number): number | null => {
    const past = closeMonthsAgo(months);
    if (past == null || past === 0) return null;
    return price / past;
  };

  const return1m = returnPct(1);
  const return3m = returnPct(3);
  const return6m = returnPct(6);
  const return9m = returnPct(9);
  const return12m = returnPct(12);

  const q1 = ratio(3);
  const q2 = ratio(6);
  const q3 = ratio(9);
  const q4 = ratio(12);
  const rsRaw =
    q1 != null && q2 != null && q3 != null && q4 != null
      ? (2 * q1 + q2 + q3 + q4) / 5
      : null;

  const sma = (period: number, offsetFromEnd = 0): number | null => {
    const end = n - offsetFromEnd;
    const start = end - period;
    if (start < 0) return null;
    let sum = 0;
    for (let i = start; i < end; i++) sum += closes[i];
    return sum / period;
  };

  const ma50 = sma(50);
  const ma150 = sma(150);
  const ma200 = sma(200);
  const ma200OneMonthAgo = sma(200, TRADING_DAYS_PER_MONTH);

  const window52w = closes.slice(-Math.min(252, n));
  const high52w = Math.max(...window52w);
  const low52w = Math.min(...window52w);

  const conditions: TrendTemplateCondition[] = [
    {
      label: "現在値 > 150日線 かつ 200日線",
      pass: ma150 != null && ma200 != null && price > ma150 && price > ma200,
    },
    {
      label: "150日線 > 200日線",
      pass: ma150 != null && ma200 != null && ma150 > ma200,
    },
    {
      label: "200日線が上昇トレンド(1ヶ月以上)",
      pass:
        ma200 != null && ma200OneMonthAgo != null && ma200 > ma200OneMonthAgo,
    },
    {
      label: "50日線 > 150日線 かつ 200日線",
      pass:
        ma50 != null &&
        ma150 != null &&
        ma200 != null &&
        ma50 > ma150 &&
        ma50 > ma200,
    },
    {
      label: "現在値 > 50日線",
      pass: ma50 != null && price > ma50,
    },
    {
      label: "現在値 ≥ 52週安値+30%",
      pass: low52w > 0 && price >= low52w * 1.3,
    },
    {
      label: "現在値 ≥ 52週高値の75%以上",
      pass: high52w > 0 && price >= high52w * 0.75,
    },
  ];
  const technicalScore = conditions.filter((c) => c.pass).length;

  return {
    price,
    return1m,
    return3m,
    return6m,
    return9m,
    return12m,
    rsRaw,
    ma50,
    ma150,
    ma200,
    high52w,
    low52w,
    technicalScore,
    technicalPass: technicalScore === conditions.length,
    conditions,
  };
}

// Percentile-rank rsRaw values across the universe into IBD-style 1-99 ratings.
export function computeRSRatings(
  rows: { code: string; rsRaw: number | null }[],
): Map<string, number> {
  const valid = rows.filter(
    (r): r is { code: string; rsRaw: number } => r.rsRaw != null,
  );
  const sorted = [...valid].sort((a, b) => a.rsRaw - b.rsRaw);
  const n = sorted.length;
  const map = new Map<string, number>();
  sorted.forEach((r, i) => {
    const pct = n > 1 ? i / (n - 1) : 1;
    const rating = Math.max(1, Math.min(99, Math.round(1 + pct * 98)));
    map.set(r.code, rating);
  });
  return map;
}

export function rsRatingColor(rating: number): string {
  if (rating >= 90) return "text-emerald-600 dark:text-emerald-400";
  if (rating >= 70) return "text-amber-600 dark:text-amber-400";
  if (rating >= 40) return "text-neutral-600 dark:text-neutral-300";
  return "text-red-600 dark:text-red-400";
}
