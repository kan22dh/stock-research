# Stock Research Dashboard — Agent guide

Quick orientation for future Claude/AI sessions touching this project.

## Mission

Help the user (a beginner Japanese retail investor) discover **small-cap growth stocks (時価総額500億円以下, 1〜2年で2-3倍候補)** via a 4-layer top-down framework: **Macro → Sector → Stock → AI judgment**.

## Stack

- Next.js 16 (App Router, React 19), TypeScript, Tailwind v4
- Prisma 6 + PostgreSQL (Vercel Prisma Postgres marketplace integration; `DATABASE_URL` is the SAME value in `.env` and Vercel prod env, so local scripts write straight to production data)
- lightweight-charts (TradingView) for candlesticks & area charts
- @anthropic-ai/sdk for AI analysis (Claude Haiku 4.5 with prompt caching) — disabled until `ANTHROPIC_API_KEY` is set
- J-Quants API v2 (X-API-Key auth) — Japanese equity **financials/forecasts only** (12-week delayed, rate-limited ~10 req/min)
- Yahoo Finance unofficial chart API — **primary price source** (real-time-ish, no auth, no meaningful rate limit, 2-5y history)
- Stooq CSV — real-time forex/commodities/major indices
- FRED CSV (no auth) — slower US macro indicators (rates, CPI, unemployment)

## Design philosophy (post-2026-07 research pivot)

This app used to be a pure "browse/compare" dashboard. A research pass into audited
winning-trader systems (US Investing Championship, Market Wizards) found every
verified champion (Minervini, Ryan, Zanger) converges on the same stack: price
**momentum ranking** + strict **technical filtering** + **position risk management**
+ **journaling** — see `RESEARCH_WINNING_SYSTEMS.md` for the full writeup and
sourcing. The app was extended accordingly rather than rebuilt; the fundamentals
screener/chart/comparison layer stayed, four new layers were added on top:

1. RS Rating (`lib/momentum.ts`) — IBD-style price-momentum percentile
2. Trend Template (`lib/momentum.ts`) — Minervini's 7 technical MA/52w conditions
3. Position tracking (`Position`/`JournalEntry` models, `/positions`) — real holdings, stop-loss, buy/sell rationale (NOT the same thing as `Watchlist`, which is just a bookmark list)
4. Goal tracker (`lib/goal.ts`, `components/goal-tracker.tsx`) — net worth vs. a configurable target/years pace (seeded via `AppSetting`: `goalTarget`, `goalStart`, `goalStartDate`, `goalYears`, `cashBalance`)

Plus a fifth complementary (non-Minervini) strategy: `lib/sector-laggards.ts`,
based on YouTuber Ozaki Kuniaki (おーちゃん, ex-Goldman Sachs)'s "money flow"
framework — find sector peers that haven't reacted yet to a catalyst a leader
already reacted to.

And a validation layer: `lib/backtest.ts` + `/backtest` — monthly-rebalanced
point-in-time backtest of the RS/Trend-Template strategy vs TOPIX ETF (1306)
buy-and-hold, using PriceCache (Yahoo-sourced 5y daily bars; sync via
`POST /api/sync-prices`). Empirical results as of 2026-07 are recorded in
`RESEARCH_WINNING_SYSTEMS.md` §7 — headline: top-10 diversification beat the
index, top-5 concentration and mechanical monthly stop-losses both hurt
(whipsaw). Yahoo bars occasionally contain corrupt prices (dropped digits);
`cleanSeries()` in backtest.ts median-filters them — don't remove it.

## Codebase map

```
src/
  app/
    page.tsx                  # Home: search + macro snapshot + top growers + history + watchlist
    layout.tsx                # Header nav + footer
    error.tsx, loading.tsx    # Global UX
    actions/
      analyze.ts              # AI single-stock analysis (Server Action)
      compare-ai.ts           # AI 2-stock comparison
      screener.ts             # Bulk financial sync (Server Action)
      search.ts               # Stock search by code/name
      watchlist.ts            # Toggle watchlist
    api/
      sync-financials/route.ts  # POST /api/sync-financials?limit=N&scale=small|mid|all[&only=missing-forecast]
      screener-csv/route.ts     # GET /api/screener-csv?growth=N&profit=N (Excel-compatible UTF-8 BOM)
    stocks/[code]/
      page.tsx                # Stock detail dashboard
      not-found.tsx
    watchlist/page.tsx
    screener/page.tsx
    sectors/page.tsx
    macro/page.tsx
    compare/page.tsx          # /compare?codes=A,B
    positions/page.tsx        # Real holdings: add/close positions, stop-loss, journal
    actions/
      positions.ts             # createPosition/closePosition/updateStopLoss/addJournalNote/updateCashBalance
      momentum.ts               # bulkSyncMomentum Server Action (screener button)
    api/
      sync-momentum/route.ts   # POST /api/sync-momentum?limit=N&scale=small|all|financials
  components/
    candle-chart.tsx          # Candlesticks + volume + MA20/MA50 + RSI(14) + timeframe switcher
    line-chart.tsx            # Area chart for FRED series
    stock-search.tsx          # Debounced search input + keyboard nav (↑↓ Enter)
    watch-toggle.tsx          # ☆ button
    ai-analyze.tsx            # AI panel for single stock
    compare-ai.tsx            # AI panel for compare
    auto-diagnose.tsx         # Rule-based tag commentary (no API needed)
    investment-score-card.tsx # ⭐ 0-100 composite score with breakdown bars
    bulk-sync-button.tsx      # "📊 30件取得" button on screener
    macro-snapshot.tsx        # Top-4 macro card grid for home
    peer-comparison-table.tsx # Selected stock + peers in same comparison row
    top-growers.tsx           # Home widget: top 5 small caps by sales YoY
    top-by-score.tsx          # Home widget: top 5 by investment score
    forecast-accelerators.tsx # Home widget: forecast YoY > actual YoY ranking
    top-growers.tsx           # Top-5 small-cap growers card list
    quota-card.tsx            # (reserved, not currently rendered)
  lib/
    db.ts                     # Prisma singleton
    jquants.ts                # J-Quants v2 client + types + 429 retry (3s/8s backoff)
    fred.ts                   # FRED CSV downloader + series catalog
    sync.ts                   # Cache-aware sync (financials + forecast in one pass)
    financial-metrics.ts      # extractAnnualSummaries, extractLatestForecast, deriveMetrics, formatters
    auto-diagnose.ts          # Rule-based stock diagnosis (no API needed)
    investment-score.ts       # Composite 0-100 score (Growth+Quality+Value+Stability+Acceleration)
    trade-schema.ts           # (legacy, unused — was for nisa-tracker)
    nisa-constants.ts         # (legacy)
    ai.ts                     # Anthropic client + analyzeStock prompt
    stock-codes.ts            # 4-digit ⇄ 5-digit code conversion
    yahoo-finance.ts          # Real-time-ish price/dividend fetch (primary price source)
    momentum.ts               # RS Rating raw score + Trend Template 7-condition scorer
    momentum-sync.ts          # syncMomentumIfStale/syncMomentumBatch (Yahoo-sourced, ~daily TTL)
    sector-laggards.ts        # Ozaki-style sector-rotation laggard scan
    goal.ts                   # Goal CAGR/pace math, reads AppSetting
prisma/
  schema.prisma               # ListedStock, PriceCache, FinancialCache, Forecast, Watchlist,
                               # BrowseHistory, SyncLog, Momentum, Position, JournalEntry, AppSetting
```

## Data model summary (Prisma)

- `ListedStock` — master, synced from `/v2/equities/master` (~4000 rows)
- `PriceCache` — daily OHLCV per code, now **Yahoo-sourced 5y bars** (`syncPricesIfStale` was switched from J-Quants to Yahoo). Doubles as the backtest data store; charts still read live Yahoo and fall back here.
- `FinancialCache` — annual financials per code/FY, synced from `/v2/fins/summary` filtered to `CurPerType="FY"`. Pre-computed `salesYoY`, `profitYoY`.
- `Forecast` — latest company-issued forecast per code, extracted from F-prefix fields on most recent quarterly disclosure. Targets `CurFYEn` for 1Q/2Q/3Q rows, `NxtFYEn` for FY rows. Pre-computed `salesYoYImplied`, `profitYoYImplied` (vs latest actual FY).
- `Momentum` — one row per code, Yahoo-sourced: `return1m/3m/6m/9m/12m`, `rsRaw` (raw IBD-style ratio — percentile-rank across rows at read-time via `computeRSRatings()`, don't compare raw values directly), `ma50/150/200`, `technicalScore`/`technicalPass` (0-7 Trend Template conditions excluding the RS-Rating-dependent 8th)
- `Position` — real holdings (not `Watchlist`): shares, entryPrice, stopLossPrice, targetPrice, status open/closed, closePrice/closeDate
- `JournalEntry` — tied to a `Position`, type buy/sell/note + reason text (required on close, by design — no reason, no close)
- `AppSetting` — key/value: `goalTarget`, `goalStart`, `goalStartDate`, `goalYears`, `cashBalance`
- `Watchlist`, `BrowseHistory`, `SyncLog`

## Sync TTLs

- ListedStock: 24h
- PriceCache: 6h (mostly irrelevant now — see note above)
- FinancialCache + Forecast (synced together): 24h
- Momentum: ~20h (Yahoo isn't rate-limited, so this is generous, not defensive)
- FRED: 6h (Next.js fetch revalidate)

## J-Quants gotchas

- v2 uses `X-API-Key` header (not `Authorization: Bearer`)
- Field names are abbreviated: `O/H/L/C/Vo/Va/AdjC/Sales/OP/NP/EPS/TA/Eq/EqAR/BPS`
- Free plan covers data 12 weeks delayed, 2-year window only — passing `to=today` returns 400
- Rate limits hit aggressively (~50 req/min); the client retries 429 with progressive backoff (3s, 8s)
- Error returned in body as JSON `{"message":"..."}`
- Codes are 5-digit (`72030` not `7203`); `lib/stock-codes.ts` converts

## FRED gotchas

- No API key needed — uses `https://fred.stlouisfed.org/graph/fredgraph.csv?id=XXX&cosd=YYYY-MM-DD`
- CSV format: header line `DATE,SERIES_ID` then `YYYY-MM-DD,value` rows where missing values are `.`

## AI gotchas

- Reads `process.env.ANTHROPIC_API_KEY`; if absent, `isAiEnabled()` returns false and UI shows a hint
- Uses Claude Haiku 4.5 (`claude-haiku-4-5-20251001`)
- System prompt has `cache_control: { type: "ephemeral" }` for prompt caching

## Common edits

### Add a new metric to the stock detail page
1. Add field to `FinancialCache` if needed (Prisma migrate)
2. Compute in `lib/financial-metrics.ts` (`deriveMetrics`)
3. Render in `app/stocks/[code]/page.tsx` MetricCard grid

### Add a new FRED series
1. Add entry to `SERIES_META` in `lib/fred.ts` with id/label/description/unit
2. Add color in `app/macro/page.tsx` `COLOR_BY_ID`
3. Optionally add to `HIGHLIGHT_IDS` in `components/macro-snapshot.tsx`

### Add a new screener filter
1. Add searchParam in `app/screener/page.tsx`
2. Add input in `FilterForm`
3. Adjust filter chain (`.filter(...)`)

## Conventions

- Server Components fetch data inline; Client Components get props
- Server Actions go in `app/actions/`; route handlers in `app/api/...`
- All currency formatted via `formatYen()` in `lib/financial-metrics.ts`
- Dark mode supported (CSS prefers-color-scheme)
- Error states: rounded-lg amber (warning), rounded-lg red (error), rounded-2xl dashed (empty)

## Don't

- Don't try to fetch all 4000 stocks' financials — rate limits will block you
- Don't put secrets (API keys) in commits — `.env` is gitignored
- Don't skip the `await syncListedInfoIfStale()` on pages that need stock list — it's the lazy-init pattern
- Don't compare `Momentum.rsRaw` values directly across stocks — it's a raw ratio, not a percentile. Always go through `computeRSRatings()` first.
- Don't confuse `Watchlist` (bookmarks, no money involved) with `Position` (real holdings with cost basis) — they're intentionally separate models
- Don't allow closing a `Position` without a `reason` — the whole point of the journal is that discipline is enforced at the schema/action level, not just suggested in the UI
