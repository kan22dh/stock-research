# Stock Research Dashboard — Agent guide

Quick orientation for future Claude/AI sessions touching this project.

## Mission

Help the user (a beginner Japanese retail investor) discover **small-cap growth stocks (時価総額500億円以下, 1〜2年で2-3倍候補)** via a 4-layer top-down framework: **Macro → Sector → Stock → AI judgment**.

## Stack

- Next.js 16 (App Router, React 19), TypeScript, Tailwind v4
- Prisma 6 + SQLite (`prisma/dev.db`, gitignored)
- lightweight-charts (TradingView) for candlesticks & area charts
- @anthropic-ai/sdk for AI analysis (Claude Haiku 4.5 with prompt caching)
- J-Quants API v2 (X-API-Key auth) — Japanese equity data, 12-week delay on free plan
- FRED CSV (no auth) — US macro indicators

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
prisma/
  schema.prisma               # Trade, ListedStock, PriceCache, FinancialCache, Watchlist, BrowseHistory, SyncLog
```

## Data model summary (Prisma)

- `ListedStock` — master, synced from `/v2/equities/master` (~4000 rows)
- `PriceCache` — daily OHLCV per code, synced from `/v2/equities/bars/daily`
- `FinancialCache` — annual financials per code/FY, synced from `/v2/fins/summary` filtered to `CurPerType="FY"`. Pre-computed `salesYoY`, `profitYoY`.
- `Forecast` — latest company-issued forecast per code, extracted from F-prefix fields on most recent quarterly disclosure. Targets `CurFYEn` for 1Q/2Q/3Q rows, `NxtFYEn` for FY rows. Pre-computed `salesYoYImplied`, `profitYoYImplied` (vs latest actual FY).
- `Watchlist`, `BrowseHistory`, `SyncLog`

## Sync TTLs

- ListedStock: 24h
- PriceCache: 6h
- FinancialCache + Forecast (synced together): 24h
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
