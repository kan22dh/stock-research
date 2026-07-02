// Yahoo Finance client for Japanese stocks (real-time + multi-year history).
// No auth, no rate limit issues for normal use. Uses query1.finance.yahoo.com chart API.

const BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const UA = "Mozilla/5.0 (compatible; stock-research-dashboard)";

export type YahooBar = {
  time: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number; // split-adjusted (Yahoo back-adjusts quote arrays for splits)
  adjClose: number | null; // split+dividend-adjusted — use for total-return math
  volume: number;
};

export type YahooQuote = {
  symbol: string;
  ticker4: string;
  currency: string;
  exchange: string;
  longName: string | null;
  // Live/latest values
  regularMarketPrice: number | null;
  regularMarketTime: number | null; // unix seconds
  regularMarketDayHigh: number | null;
  regularMarketDayLow: number | null;
  regularMarketVolume: number | null;
  previousClose: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  // Historical bars (sorted ascending by date)
  bars: YahooBar[];
};

// J-Quants 5-digit "12340" → Yahoo "1234.T"
// 4-digit short "1234" → "1234.T"
// Alphanumeric "167A0" → "167A.T"
export function toYahooSymbol(code: string): string {
  const c = code.trim().toUpperCase();
  if (/^\d{4}[A-Z0-9]?\d$/.test(c) && c.length === 5) {
    // 5-char J-Quants form, drop the trailing 0
    return `${c.slice(0, 4)}.T`;
  }
  if (/^\d{3}[A-Z]\d$/.test(c) && c.length === 5) {
    return `${c.slice(0, 4)}.T`;
  }
  if (c.length === 4) return `${c}.T`;
  return `${c}.T`;
}

export type YahooRange =
  | "1mo"
  | "3mo"
  | "6mo"
  | "1y"
  | "2y"
  | "5y"
  | "10y"
  | "max";

export async function fetchYahoo(
  code: string,
  range: YahooRange = "2y",
  revalidateSec = 60,
): Promise<YahooQuote | null> {
  const symbol = toYahooSymbol(code);
  const url = `${BASE}/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      next: { revalidate: revalidateSec },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: Record<string, unknown>;
          timestamp?: number[];
          indicators?: {
            quote?: Array<Record<string, Array<number | null>>>;
            adjclose?: Array<{ adjclose?: Array<number | null> }>;
          };
        }>;
        error?: unknown;
      };
    };
    const r = json.chart?.result?.[0];
    if (!r || !r.meta) return null;
    const m = r.meta;
    const ts = r.timestamp ?? [];
    const q = r.indicators?.quote?.[0] ?? {};
    const open = q.open ?? [];
    const high = q.high ?? [];
    const low = q.low ?? [];
    const close = q.close ?? [];
    const volume = q.volume ?? [];
    const adjclose = r.indicators?.adjclose?.[0]?.adjclose ?? [];

    const bars: YahooBar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = open[i],
        h = high[i],
        l = low[i],
        c = close[i],
        v = volume[i];
      if (o == null || h == null || l == null || c == null) continue;
      const date = new Date(ts[i] * 1000);
      const yyyymmdd = date.toISOString().slice(0, 10);
      bars.push({
        time: yyyymmdd,
        open: o,
        high: h,
        low: l,
        close: c,
        adjClose: adjclose[i] ?? null,
        volume: v ?? 0,
      });
    }

    const ticker4 =
      typeof m.symbol === "string" ? m.symbol.replace(".T", "") : code;

    // PROPER previousClose: the close of the bar before the latest one.
    // Yahoo's `chartPreviousClose` is actually the start-of-range close (e.g.
    // 5 years ago when range=5y) — using it would produce wildly wrong day-change.
    // `meta.previousClose` is often null too. Bars are always reliable.
    const livePrice = numOrNull(m.regularMarketPrice);
    let previousClose: number | null = null;
    if (bars.length >= 2) {
      const last = bars[bars.length - 1];
      // If livePrice equals the last bar's close, "previous" is the bar before
      // that. If livePrice is intraday (different from last bar's close), the
      // last bar IS the previous close.
      if (livePrice != null && Math.abs(livePrice - last.close) > 0.01) {
        previousClose = last.close;
      } else {
        previousClose = bars[bars.length - 2].close;
      }
    }

    return {
      symbol: typeof m.symbol === "string" ? m.symbol : symbol,
      ticker4,
      currency: typeof m.currency === "string" ? m.currency : "JPY",
      exchange: typeof m.fullExchangeName === "string" ? m.fullExchangeName : "Tokyo",
      longName: typeof m.longName === "string" ? m.longName : null,
      regularMarketPrice: livePrice,
      regularMarketTime: numOrNull(m.regularMarketTime),
      regularMarketDayHigh: numOrNull(m.regularMarketDayHigh),
      regularMarketDayLow: numOrNull(m.regularMarketDayLow),
      regularMarketVolume: numOrNull(m.regularMarketVolume),
      previousClose,
      fiftyTwoWeekHigh: numOrNull(m.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: numOrNull(m.fiftyTwoWeekLow),
      bars,
    };
  } catch {
    return null;
  }
}

// ----- Dividends -----

export type YahooDividend = {
  date: string;   // YYYY-MM-DD (ex-dividend / record date proxy)
  amount: number;
};

export async function fetchYahooDividends(
  code: string,
  yearsBack = 3,
  revalidateSec = 3600,
): Promise<YahooDividend[]> {
  const symbol = toYahooSymbol(code);
  const range = `${yearsBack}y`;
  const url = `${BASE}/${encodeURIComponent(symbol)}?interval=1d&range=${range}&events=div`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      next: { revalidate: revalidateSec },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      chart?: {
        result?: Array<{
          events?: { dividends?: Record<string, { date: number; amount: number }> };
        }>;
      };
    };
    const divs = json.chart?.result?.[0]?.events?.dividends ?? {};
    const list: YahooDividend[] = [];
    for (const v of Object.values(divs)) {
      if (typeof v.date === "number" && typeof v.amount === "number") {
        list.push({
          date: new Date(v.date * 1000).toISOString().slice(0, 10),
          amount: v.amount,
        });
      }
    }
    list.sort((a, b) => a.date.localeCompare(b.date));
    return list;
  } catch {
    return [];
  }
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}
