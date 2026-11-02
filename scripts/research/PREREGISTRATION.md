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

---

# Round 2 result + data repair (recorded 2026-11-02, after running)

Data repair (correction, not new trials): Yahoo long history had series with
one-day moves beyond ×0.6/×1.7 (impossible under TSE daily limits) — 63/1,256
series. Examples: 1306's 10:1 split on 2015-01-05 unadjusted (benchmark showed
−90%); 7944 Roland stitched its pre-2014 listing to its 2020 relisting, which
B0 repeatedly bought on fake momentum (+137% fake month). `repairBreaks()`
rescales 1306 and drops pre-break history elsewhere. Applied to BOTH datasets.
The 10y dataset is the same Yahoo data as production PriceCache, so the old
"+18.7%" backtest was inflated by such series too.

Repaired baseline B0 (10y): +7.3% vs TOPIX +10.7% to 2025-10; +14.3% vs +12.3%
to 2026-06; +9.2% vs +11.9% to 2026-10. Max DD −45.9%.

Round 1 rerun on repaired data: 6a/6b (top 15/20) pass both 10y halves, but on
the long windows top20 fails L1 (+21.6% vs B0 +30.1%) → not adopted.
Round 2 (repaired): no trial passes the rule. The 18 family (RS + dividend
yield composite) beats B0 in L2, H1, H2 but not L1 (2009–17) for any weight.
Observed but NOT a pass: all three 18 weights beat TOPIX in every window with
max DD −26%…−37% vs B0 −52%. Changing the criterion to "vs TOPIX" after seeing
this would be a forking-paths error, so it is not done.
Dividend data sanity: holdings' trailing yield median 3.0%, p90 4.9%, max
10.7% (special dividends, e.g. Avex 2021) — no split-corrupted dividends.
Trial count so far: 16 (round 1) + 12 (round 2: 9 stock trials incl. one
neighbour, 3 leverage) = 28.

# Holdout declaration (written and committed BEFORE the holdout is run)

- Candidate: 18a (RS rank 50% + trailing dividend-yield rank 50%, Trend
  Template required, top 10, monthly). Chosen because 50/50 is the
  literature's prior (Asness value+momentum), NOT because it scored best
  (18c did; picking it would be in-sample selection).
- Only three series are run on the holdout: 18a, B0, TOPIX (1306).
- Window: rebalance 2025-10-31 → 2026-10-30 (12 months), long repaired dataset.
- PASS iff 18a's holdout return > TOPIX AND > B0, AND 18a's max drawdown is no
  worse than B0's + 5pt. Anything else = FAIL, and there is no v2.
- If PASS: v2 becomes an EXPERIMENTAL paper account, labelled
  「事前登録基準は不合格・ホールドアウトのみ合格の候補」, v1 untouched as control.
- Either way this is the last research round of this rebuild.
- Known caveats: 12 months is thin evidence; survivorship bias likely
  flatters a yield tilt (delisted yield traps are absent from the data).

# Holdout result (run once, 2026-11-02, scripts/research/holdout.ts)

Window 2025-10-31 → 2026-10-30 (12 months):
- TOPIX (1306): +21.5%, max DD −7.4%
- B0:           +26.2%, max DD −32.1% (incl. a −32.1% month, 2026-07)
- 18a:          +20.3%, max DD −15.6%

VERDICT: FAIL (18a < TOPIX). Per the declaration there is no v2; v1 stays
as the only paper account. This was the last research round of the rebuild.

# Overall conclusion of the 2026-11 rebuild research

28 trials + 1 holdout. No tested rule beat the momentum baseline robustly,
and the momentum baseline itself has not beaten TOPIX since 2017 on repaired
data (+7.3% vs +10.7%/yr to 2025-10). Its 2009–17 strength (+30%/yr) sits in
the window where survivorship bias and the Abenomics rally are largest.
The only consistent effect found is risk reduction, not return: blending a
dividend-yield rank into the RS rank roughly halves drawdown at a similar
return, and broader books (top 15–20) also cut drawdown.
10× in 10 years needs 25.9%/yr. Nothing here supports expecting that from
stock selection rules; TOPIX at ~12%/yr compounds to ~3× in 10 years.
