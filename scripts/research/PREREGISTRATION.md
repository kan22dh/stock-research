# v2 strategy research — pre-registration (written 2026-11-02, BEFORE any run)

Goal set by the owner: 10x in 10 years = 25.9%/yr. Constraints: TSE-listed
stocks + 1306 only (SBI), NISA → no margin, no leveraged/inverse ETFs.

## Data and windows
- Local Yahoo dataset (scripts/build-dataset.ts), adjClose total return,
  ~1,270 currently listed stocks (survivorship bias: results are optimistic,
  most of all for small caps).
- Development window: first rebalance with 12m history → 2025-10-31.
  Halves: H1 = up to 2021-10-31, H2 = 2021-11 → 2025-10.
- HOLDOUT: 2025-11 → 2026-10 (12 months). Never used to choose anything.
  Reported once, after the final choice.
- Cost 20 bps per side on turnover. Monthly rebalance at month-end close.

## Baseline
B0: top 10 by RS raw (IBD-style 2Q1+Q2+Q3+Q4) among Trend Template passers.
(= v1 without the sales gate, which cannot be tested over 10y.)

## Candidate list (each counts as a trial; neighbours in braces)
1. Index trend filter: hold only when TOPIX ETF > its N-month SMA, else cash. N {6, 10, 12}
2. Risk-adjusted momentum: rank by rsRaw / vol(60d). vol window {60, 120}
3. 52-week-high proximity ranking instead of RS (George & Hwang 2004)
4. Momentum + value proxy (long-term reversal, the only 10y-testable stand-in
   for value — Asness: value & momentum −0.55 correlated in Japan):
   composite rank = rank(RS) + rank(−return from t−L to t−12m). L {36m, 60m}
5. Sector cap 3 (re-check on the new engine; neighbours 2, 4)
6. Breadth: top N {15, 20}
7. Skip-month momentum (12-1): RS measured up to t−1 month
8. Liquidity floor: 60d average turnover ≥ ¥100M/day
9. Combination of survivors of 1–8 (at most 3 combos)

Planned trials ≈ 18. With that many, the best variant beats B0 by chance;
so a variant is ADOPTED only if:
  (a) CAGR better than B0 in BOTH halves, and
  (b) max drawdown no worse than B0 + 5pt in both halves, and
  (c) its neighbour parameter values also beat B0 in both halves.
Fundamentals-based ideas (sales growth gate, PBR value, ROE quality) have
only ~2 years of data: they are reported as provisional, never as validated.

## Explicitly NOT used as rules (no evidence of predictive power found)
- Foreign-investor weekly flows (JPX 投資部門別売買状況): only ex-post explanations in the literature.
- X / AI "success stories": unverifiable, survivorship-biased.
- JGB / US yield levels, USD/JPY: shown on the dashboard as context only.
