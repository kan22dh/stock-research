// Stooq CSV quote fetcher (no auth required, ~5-min delayed real-time data).
// Source: https://stooq.com/q/l/?s=...&i=d&f=sd2t2ohlcv&h&e=csv

const BASE = "https://stooq.com/q/l/";

export type StooqQuote = {
  id: string;          // Internal id
  symbol: string;      // Stooq symbol
  label: string;       // Japanese label
  description: string; // Short description
  unit: string;
  date: string | null; // YYYY-MM-DD
  time: string | null; // HH:MM:SS
  price: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  available: boolean;
};

export const STOOQ_INSTRUMENTS = {
  usdjpy: {
    symbol: "usdjpy",
    label: "ドル円 (USD/JPY)",
    description: "Real-time forex rate",
    unit: "JPY",
  },
  eurjpy: {
    symbol: "eurjpy",
    label: "ユーロ円 (EUR/JPY)",
    description: "Real-time forex rate",
    unit: "JPY",
  },
  oil: {
    symbol: "cl.f",
    label: "WTI原油先物",
    description: "West Texas Intermediate (front month)",
    unit: "USD/barrel",
  },
  gold: {
    symbol: "gc.f",
    label: "金先物",
    description: "Gold futures",
    unit: "USD/oz",
  },
  nikkei: {
    symbol: "^nkx",
    label: "日経平均株価",
    description: "Nikkei 225 Index",
    unit: "Index",
  },
  sp500: {
    symbol: "^spx",
    label: "S&P 500",
    description: "S&P 500 Index",
    unit: "Index",
  },
  topix: {
    symbol: "^tpx",
    label: "TOPIX",
    description: "Tokyo Stock Price Index",
    unit: "Index",
  },
  dow: {
    symbol: "^dji",
    label: "NYダウ",
    description: "Dow Jones Industrial Average",
    unit: "Index",
  },
} as const;

export type StooqInstrumentId = keyof typeof STOOQ_INSTRUMENTS;

function toNum(s: string): number | null {
  if (!s || s === "N/D") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export async function fetchStooqQuote(id: StooqInstrumentId): Promise<StooqQuote> {
  const meta = STOOQ_INSTRUMENTS[id];
  const url = `${BASE}?s=${encodeURIComponent(meta.symbol)}&i=d&f=sd2t2ohlcv&h&e=csv`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "stock-research-dashboard" },
      next: { revalidate: 60 }, // 1-minute cache (Next.js fetch)
    });
    if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`);
    const csv = await res.text();
    const lines = csv.trim().split("\n");
    if (lines.length < 2) throw new Error("Empty Stooq response");
    const fields = lines[1].split(",");
    // Symbol,Date,Time,Open,High,Low,Close,Volume
    const date = fields[1] && fields[1] !== "N/D" ? fields[1] : null;
    const close = toNum(fields[6]);
    return {
      id,
      symbol: meta.symbol,
      label: meta.label,
      description: meta.description,
      unit: meta.unit,
      date,
      time: fields[2] && fields[2] !== "N/D" ? fields[2] : null,
      open: toNum(fields[3]),
      high: toNum(fields[4]),
      low: toNum(fields[5]),
      price: close,
      volume: toNum(fields[7]),
      available: date != null && close != null,
    };
  } catch {
    return {
      id,
      symbol: meta.symbol,
      label: meta.label,
      description: meta.description,
      unit: meta.unit,
      date: null,
      time: null,
      open: null,
      high: null,
      low: null,
      price: null,
      volume: null,
      available: false,
    };
  }
}

export async function fetchAllStooqQuotes(
  ids: StooqInstrumentId[],
): Promise<StooqQuote[]> {
  const results = await Promise.allSettled(ids.map((id) => fetchStooqQuote(id)));
  return results
    .filter((r): r is PromiseFulfilledResult<StooqQuote> => r.status === "fulfilled")
    .map((r) => r.value);
}

export function changePct(
  current: number | null,
  prev: number | null,
): number | null {
  if (current == null || prev == null || prev === 0) return null;
  return ((current - prev) / prev) * 100;
}
