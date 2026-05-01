// Composite investment-attractiveness score (0-100) tuned for small-cap growth investing.
// Components and max points:
//   Growth (40):  actual sales YoY ≥ 50% → 40 pts (linear from 0% to 50%, capped)
//   Quality (20): ROE ≥ 25% → 20 pts (linear from 0% to 25%, capped)
//   Value (20):   PER 0-10 → 20 pts; PER 10-30 → linear 20→0; PER < 0 → 0; PER > 30 → 0
//   Stability (10): equityRatio in 0-100, mapped to 0..10 (cap at 60% = 10 pts)
//   Acceleration (10): forecastYoY - actualYoY (cap at +20 = 10 pts; clamp negative at 0)
// Total = sum, clamped 0..100

export type InvestmentScoreInput = {
  salesYoY: number | null;
  roe: number | null;          // %
  per: number | null;          // ratio
  equityRatio: number | null;  // % (0-100)
  forecastSalesYoY: number | null;
};

export type InvestmentScoreBreakdown = {
  growth: number;
  quality: number;
  value: number;
  stability: number;
  acceleration: number;
  total: number;
};

export function investmentScore(
  i: InvestmentScoreInput,
): InvestmentScoreBreakdown | null {
  // If we don't have at least growth + roe, score is meaningless
  if (i.salesYoY == null && i.roe == null) return null;

  const growth = i.salesYoY != null ? clamp((i.salesYoY / 50) * 40, 0, 40) : 0;
  const quality = i.roe != null ? clamp((i.roe / 25) * 20, 0, 20) : 0;
  let value = 0;
  if (i.per != null) {
    if (i.per >= 0 && i.per <= 10) value = 20;
    else if (i.per > 10 && i.per <= 30) value = 20 - ((i.per - 10) / 20) * 20;
    else value = 0;
  }
  const stability =
    i.equityRatio != null ? clamp((i.equityRatio / 60) * 10, 0, 10) : 0;
  let acceleration = 0;
  if (i.forecastSalesYoY != null && i.salesYoY != null) {
    const accel = i.forecastSalesYoY - i.salesYoY;
    acceleration = clamp((accel / 20) * 10, 0, 10);
  } else if (i.forecastSalesYoY != null && i.forecastSalesYoY > 0) {
    acceleration = clamp((i.forecastSalesYoY / 30) * 10, 0, 10);
  }

  const total = clamp(growth + quality + value + stability + acceleration, 0, 100);
  return { growth, quality, value, stability, acceleration, total };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function scoreColor(total: number): string {
  if (total >= 70) return "text-emerald-600 dark:text-emerald-400";
  if (total >= 50) return "text-amber-600 dark:text-amber-400";
  if (total >= 30) return "text-neutral-600 dark:text-neutral-300";
  return "text-red-600 dark:text-red-400";
}

export function scoreBgColor(total: number): string {
  if (total >= 70) return "bg-emerald-500";
  if (total >= 50) return "bg-amber-500";
  if (total >= 30) return "bg-neutral-400";
  return "bg-red-500";
}
