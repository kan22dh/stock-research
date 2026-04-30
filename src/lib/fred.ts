// FRED (Federal Reserve Economic Data) loader.
// Uses the public fredgraph.csv URL which doesn't require an API key
// for simple time-series downloads.

const BASE = "https://fred.stlouisfed.org/graph/fredgraph.csv";

export type FredPoint = {
  date: string; // YYYY-MM-DD
  value: number | null;
};

export type FredSeries = {
  id: string;
  label: string;
  description: string;
  unit: string;
  source: "FRED";
  points: FredPoint[];
};

const SERIES_META: Record<string, Omit<FredSeries, "points" | "source">> = {
  DFF: {
    id: "DFF",
    label: "米FF金利",
    description: "Federal Funds Effective Rate (実効FF金利)",
    unit: "%",
  },
  DGS10: {
    id: "DGS10",
    label: "米10年国債利回り",
    description: "10-Year Treasury Constant Maturity",
    unit: "%",
  },
  CPIAUCSL: {
    id: "CPIAUCSL",
    label: "米CPI（消費者物価指数）",
    description: "Consumer Price Index, All Urban (Index 1982-84=100)",
    unit: "Index",
  },
  UNRATE: {
    id: "UNRATE",
    label: "米失業率",
    description: "Unemployment Rate (季節調整済み)",
    unit: "%",
  },
  DEXJPUS: {
    id: "DEXJPUS",
    label: "円ドルレート (USD/JPY)",
    description: "Japan / U.S. Foreign Exchange Rate",
    unit: "JPY per USD",
  },
  DCOILWTICO: {
    id: "DCOILWTICO",
    label: "WTI原油価格",
    description: "Crude Oil Prices: West Texas Intermediate",
    unit: "$/barrel",
  },
  PAYEMS: {
    id: "PAYEMS",
    label: "米非農業部門雇用者数",
    description: "All Employees, Total Nonfarm (千人, 季節調整済)",
    unit: "千人",
  },
  VIXCLS: {
    id: "VIXCLS",
    label: "VIX指数（恐怖指数）",
    description: "CBOE Volatility Index - 市場のリスク認識",
    unit: "Index",
  },
};

export const FRED_SERIES_IDS = Object.keys(SERIES_META) as Array<keyof typeof SERIES_META>;

export async function fetchFredSeries(
  id: string,
  options: { sinceYears?: number } = {},
): Promise<FredSeries> {
  const meta = SERIES_META[id];
  if (!meta) throw new Error(`Unknown FRED series: ${id}`);

  const since = new Date();
  since.setFullYear(since.getFullYear() - (options.sinceYears ?? 5));
  const sinceStr = since.toISOString().slice(0, 10);

  const url = `${BASE}?id=${encodeURIComponent(id)}&cosd=${sinceStr}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "stock-research-dashboard" },
    next: { revalidate: 60 * 60 * 6 }, // cache 6h on the Next.js side
  });
  if (!res.ok) throw new Error(`FRED fetch failed (${res.status}) for ${id}`);

  const csv = await res.text();
  const lines = csv.split("\n").filter(Boolean);
  // header is "DATE,SERIES_ID" (or "observation_date,VALUE" in newer formats)
  const header = lines.shift();
  if (!header) throw new Error("Empty FRED response");

  const points: FredPoint[] = [];
  for (const line of lines) {
    const [dateRaw, valRaw] = line.split(",");
    const date = (dateRaw ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const v = (valRaw ?? "").trim();
    const num = v === "." || v === "" ? null : Number(v);
    points.push({ date, value: num != null && Number.isFinite(num) ? num : null });
  }

  return { ...meta, source: "FRED", points };
}

export async function fetchAllMacroSeries(): Promise<FredSeries[]> {
  const results = await Promise.allSettled(
    FRED_SERIES_IDS.map((id) => fetchFredSeries(id, { sinceYears: 5 })),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<FredSeries> => r.status === "fulfilled")
    .map((r) => r.value);
}

// Helper: latest non-null value in a series
export function latestValue(series: FredSeries): {
  value: number | null;
  date: string | null;
  prevValue: number | null;
  changeYoY: number | null;
} {
  const valid = series.points.filter((p): p is { date: string; value: number } => p.value !== null);
  if (valid.length === 0) return { value: null, date: null, prevValue: null, changeYoY: null };
  const latest = valid[valid.length - 1];
  // Find a value ~1 year ago
  const targetDate = new Date(latest.date);
  targetDate.setFullYear(targetDate.getFullYear() - 1);
  const targetStr = targetDate.toISOString().slice(0, 10);
  let yoyMatch: typeof valid[number] | null = null;
  for (let i = valid.length - 1; i >= 0; i--) {
    if (valid[i].date <= targetStr) {
      yoyMatch = valid[i];
      break;
    }
  }
  const changeYoY =
    yoyMatch && yoyMatch.value !== 0
      ? ((latest.value - yoyMatch.value) / Math.abs(yoyMatch.value)) * 100
      : null;
  return {
    value: latest.value,
    date: latest.date,
    prevValue: yoyMatch?.value ?? null,
    changeYoY,
  };
}
