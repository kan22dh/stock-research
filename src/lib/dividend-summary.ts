import type { YahooDividend } from "./yahoo-finance";

export type DividendSummary = {
  annualAmount: number | null;       // sum of dividends in last 12 months
  trailingYield: number | null;      // annual / current price * 100
  count12m: number;                   // number of payments in last 12 months
  recent: YahooDividend[];           // newest first, up to 6
  nextExDateEstimate: string | null;  // approx based on prior year same month
};

export function summarizeDividends(
  dividends: YahooDividend[],
  latestPrice: number | null,
): DividendSummary {
  if (dividends.length === 0) {
    return {
      annualAmount: null,
      trailingYield: null,
      count12m: 0,
      recent: [],
      nextExDateEstimate: null,
    };
  }

  const today = new Date();
  const oneYearAgo = new Date(today);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const cutoff = oneYearAgo.toISOString().slice(0, 10);

  const trailing = dividends.filter((d) => d.date >= cutoff);
  const annualAmount =
    trailing.length > 0 ? trailing.reduce((sum, d) => sum + d.amount, 0) : null;
  const trailingYield =
    annualAmount != null && latestPrice != null && latestPrice !== 0
      ? (annualAmount / latestPrice) * 100
      : null;

  // Sort newest first, take 6
  const recent = [...dividends].reverse().slice(0, 6);

  // Estimate next ex-date: take the latest dividend's date and add 1 year
  let nextExDateEstimate: string | null = null;
  if (dividends.length > 0) {
    const last = dividends[dividends.length - 1];
    const lastDate = new Date(last.date);
    if (lastDate < today) {
      // The last paid one was historic; next would be ~1 year later from same date
      const next = new Date(lastDate);
      next.setFullYear(next.getFullYear() + 1);
      nextExDateEstimate = next.toISOString().slice(0, 10);
    }
  }

  return {
    annualAmount,
    trailingYield,
    count12m: trailing.length,
    recent,
    nextExDateEstimate,
  };
}
