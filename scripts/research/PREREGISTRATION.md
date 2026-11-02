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

---

# Round 1 result (recorded 2026-11-02, after running)

- Engine reconciliation: old src/lib/backtest.ts and new engine give identical
  results on the same data (scripts/research/reconcile.ts).
- **Baseline B0 does not beat TOPIX over the full window.** To 2025-10: +9.5%
  vs TOPIX +10.7%. To 2026-06: +16.1% vs +12.3% (the window behind the old
  "+17–18.7%" claim). To 2026-10: +10.9% vs +11.9%.
- Only 5b (sector cap 3) beat B0 in both halves; neighbours 5a/5c fail →
  rejected by rule (c), same as the 2026-08 test.
- 4a/4b were UNTESTABLE in H1 (≈5 and 0 holdings: need 36/60m of history
  on a dataset starting 2016-11), not "failed".
- 2b (RS÷vol120) roughly halved dev drawdown (−21% vs −40%) at a lower CAGR:
  recorded as a risk-reduction result, not adopted.

# Round 2 addendum (written BEFORE running round 2) — trial budget 11 (cumulative 27)

New data: daily history from 2000 for stocks (Yahoo period1), 1306 from
2009-01, dividends included. Survivorship bias is larger on a longer history.
1306's Yahoo dividends start 2013-07, so the benchmark is understated by
roughly its yield (~2%/yr) before that: strategies look better than they are
in 2009–2013.

Windows: LONG = 2009-01 → 2025-10. Halves L1 = → 2017-04-30, L2 = 2017-05 → 2025-10.
Holdout unchanged (2025-11 → 2026-10), still sealed.

Trials:
17a Dividend-yield value: top 10 by trailing-12m yield (div / close, same split basis), no TT
17b same, top 20
18a RS + yield rank composite 50/50 (TT required)   neighbours: 18b 70/30, 18c 30/70
19  2b (RS÷vol120) re-check on LONG
20a 4a (RS + 36m reversal) on LONG   20b 4b (60m) on LONG
21a Leveraged index timing (OUTSIDE NISA, risk option only): hold 1570 when
    Nikkei 225 > its 10-month SMA, else cash.  neighbours 21b 6m, 21c 12m.
    Reported with max drawdown and worst 12-month return. Not eligible to be
    v2 on CAGR alone.

Adoption rule unchanged: beat B0 in BOTH long halves (and both 10y halves
where testable), DD no worse than B0 + 5pt, neighbours also pass.

Stopping rule: if nothing passes, round 2 is the last round. The report says
so plainly, with the honest arithmetic of what 10x requires.
