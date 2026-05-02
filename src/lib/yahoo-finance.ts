// Yahoo Finance client for Japanese stocks (real-time + multi-year history).
// No auth, no rate limit issues for normal use. Uses query1.finance.yahoo.com chart API.

const BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const UA = "Mozilla/5.0 (compatible; stock-research-dashboard)";

export type YahooBar = {
  time: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
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
          indicators?: { quote?: Array<Record<string, Array<number | null>>> };
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
        volume: v ?? 0,
      });
    }

    const ticker4 =
      typeof m.symbol === "string" ? m.symbol.replace(".T", "") : code;

    return {
      symbol: typeof m.symbol === "string" ? m.symbol : symbol,
      ticker4,
      currency: typeof m.currency === "string" ? m.currency : "JPY",
      exchange: typeof m.fullExchangeName === "string" ? m.fullExchangeName : "Tokyo",
      longName: typeof m.longName === "string" ? m.longName : null,
      regularMarketPrice: numOrNull(m.regularMarketPrice),
      regularMarketTime: numOrNull(m.regularMarketTime),
      regularMarketDayHigh: numOrNull(m.regularMarketDayHigh),
      regularMarketDayLow: numOrNull(m.regularMarketDayLow),
      regularMarketVolume: numOrNull(m.regularMarketVolume),
      previousClose:
        numOrNull(m.previousClose) ?? numOrNull(m.chartPreviousClose),
      fiftyTwoWeekHigh: numOrNull(m.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: numOrNull(m.fiftyTwoWeekLow),
      bars,
    };
  } catch {
    return null;
  }
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}
