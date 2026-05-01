// J-Quants API v2 client (X-API-Key authentication)
// Spec: https://jpx-jquants.com/spec/

const BASE_URL = "https://api.jquants.com/v2";

export class JQuantsAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JQuantsAuthError";
  }
}

export class JQuantsApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "JQuantsApiError";
  }
}

function getApiKey(): string {
  // Support both new var name and the legacy one used during MVP setup
  const key = (
    process.env.JQUANTS_API_KEY ?? process.env.JQUANTS_REFRESH_TOKEN
  )?.trim();
  if (!key) {
    throw new JQuantsAuthError(
      "JQUANTS_API_KEY が設定されていません。.env を確認してください。",
    );
  }
  return key;
}

async function authedFetch(
  path: string,
  params?: Record<string, string>,
): Promise<unknown> {
  const apiKey = getApiKey();
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }

  let lastBody = "";
  let lastStatus = 0;
  const RETRY_429_DELAYS_MS = [3000, 8000]; // try once after 3s, then 8s
  for (let attempt = 0; attempt <= RETRY_429_DELAYS_MS.length; attempt++) {
    const res = await fetch(url.toString(), {
      headers: { "X-API-Key": apiKey },
    });
    if (res.ok) return res.json();
    lastStatus = res.status;
    lastBody = await res.text();
    if (res.status === 401 || res.status === 403) {
      throw new JQuantsAuthError(
        `J-Quants 認証失敗 (${res.status}): ${lastBody.slice(0, 200)}`,
      );
    }
    if (res.status === 429 && attempt < RETRY_429_DELAYS_MS.length) {
      await new Promise((r) => setTimeout(r, RETRY_429_DELAYS_MS[attempt]));
      continue;
    }
    break;
  }
  throw new JQuantsApiError(
    `J-Quants API エラー ${lastStatus}: ${lastBody.slice(0, 200)}`,
    lastStatus,
  );
}

async function fetchAllPaginated<TInternal>(
  path: string,
  params: Record<string, string>,
  mapper: (raw: Record<string, unknown>) => TInternal,
): Promise<TInternal[]> {
  const all: TInternal[] = [];
  let paginationKey: string | undefined;
  let safety = 0;
  do {
    const res = (await authedFetch(path, {
      ...params,
      ...(paginationKey ? { pagination_key: paginationKey } : {}),
    })) as Record<string, unknown>;
    const arr = res.data;
    if (Array.isArray(arr)) {
      for (const r of arr) all.push(mapper(r as Record<string, unknown>));
    }
    paginationKey =
      typeof res.pagination_key === "string" ? res.pagination_key : undefined;
    safety++;
    if (safety > 80) break;
  } while (paginationKey);
  return all;
}

// ---------- Public types (kept stable so other modules don't change) ----------

export type ListedInfo = {
  Date: string;
  Code: string;
  CompanyName: string;
  CompanyNameEnglish?: string;
  Sector17Code?: string;
  Sector17CodeName?: string;
  Sector33Code?: string;
  Sector33CodeName?: string;
  ScaleCategory?: string;
  MarketCode?: string;
  MarketCodeName?: string;
};

export type DailyQuote = {
  Date: string;
  Code: string;
  Open: number | null;
  High: number | null;
  Low: number | null;
  Close: number | null;
  Volume: number | null;
  TurnoverValue: number | null;
  AdjustmentOpen?: number | null;
  AdjustmentHigh?: number | null;
  AdjustmentLow?: number | null;
  AdjustmentClose?: number | null;
  AdjustmentVolume?: number | null;
};

export type StatementRow = {
  DisclosedDate: string;
  DisclosedTime?: string;
  LocalCode: string;
  DisclosureNumber: string;
  TypeOfDocument: string;
  TypeOfCurrentPeriod: string;
  CurrentPeriodStartDate: string;
  CurrentPeriodEndDate: string;
  CurrentFiscalYearStartDate: string;
  CurrentFiscalYearEndDate: string;
  NextFiscalYearStartDate?: string;
  NextFiscalYearEndDate?: string;
  NetSales?: string;
  OperatingProfit?: string;
  OrdinaryProfit?: string;
  Profit?: string;
  EarningsPerShare?: string;
  TotalAssets?: string;
  Equity?: string;
  EquityToAssetRatio?: string;
  BookValuePerShare?: string;
  ResultDividendPerShareAnnual?: string;
  // Forecasts (F-prefix in v2; consolidated, full-year)
  ForecastNetSales?: string;
  ForecastOperatingProfit?: string;
  ForecastOrdinaryProfit?: string;
  ForecastProfit?: string;
  ForecastEarningsPerShare?: string;
  ForecastDividendPerShareAnnual?: string;
};

// ---------- Mappers (v2 short keys → internal long keys) ----------

function pickStr(o: Record<string, unknown>, k: string): string | undefined {
  const v = o[k];
  return typeof v === "string" ? v : undefined;
}
function pickNum(o: Record<string, unknown>, k: string): number | null {
  const v = o[k];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function mapListedInfo(r: Record<string, unknown>): ListedInfo {
  return {
    Date: pickStr(r, "Date") ?? "",
    Code: pickStr(r, "Code") ?? "",
    CompanyName: pickStr(r, "CoName") ?? "",
    CompanyNameEnglish: pickStr(r, "CoNameEn"),
    Sector17Code: pickStr(r, "S17"),
    Sector17CodeName: pickStr(r, "S17Nm"),
    Sector33Code: pickStr(r, "S33"),
    Sector33CodeName: pickStr(r, "S33Nm"),
    ScaleCategory: pickStr(r, "ScaleCat"),
    MarketCode: pickStr(r, "Mkt"),
    MarketCodeName: pickStr(r, "MktNm"),
  };
}

function mapDailyQuote(r: Record<string, unknown>): DailyQuote {
  return {
    Date: pickStr(r, "Date") ?? "",
    Code: pickStr(r, "Code") ?? "",
    Open: pickNum(r, "O"),
    High: pickNum(r, "H"),
    Low: pickNum(r, "L"),
    Close: pickNum(r, "C"),
    Volume: pickNum(r, "Vo"),
    TurnoverValue: pickNum(r, "Va"),
    AdjustmentOpen: pickNum(r, "AdjO"),
    AdjustmentHigh: pickNum(r, "AdjH"),
    AdjustmentLow: pickNum(r, "AdjL"),
    AdjustmentClose: pickNum(r, "AdjC"),
    AdjustmentVolume: pickNum(r, "AdjVo"),
  };
}

function mapStatement(r: Record<string, unknown>): StatementRow {
  return {
    DisclosedDate: pickStr(r, "DiscDate") ?? "",
    DisclosedTime: pickStr(r, "DiscTime"),
    LocalCode: pickStr(r, "Code") ?? "",
    DisclosureNumber: pickStr(r, "DiscNo") ?? "",
    TypeOfDocument: pickStr(r, "DocType") ?? "",
    TypeOfCurrentPeriod: pickStr(r, "CurPerType") ?? "",
    CurrentPeriodStartDate: pickStr(r, "CurPerSt") ?? "",
    CurrentPeriodEndDate: pickStr(r, "CurPerEn") ?? "",
    CurrentFiscalYearStartDate: pickStr(r, "CurFYSt") ?? "",
    CurrentFiscalYearEndDate: pickStr(r, "CurFYEn") ?? "",
    NextFiscalYearStartDate: pickStr(r, "NxtFYSt"),
    NextFiscalYearEndDate: pickStr(r, "NxtFYEn"),
    NetSales: pickStr(r, "Sales"),
    OperatingProfit: pickStr(r, "OP"),
    OrdinaryProfit: pickStr(r, "OdP"),
    Profit: pickStr(r, "NP"),
    EarningsPerShare: pickStr(r, "EPS"),
    TotalAssets: pickStr(r, "TA"),
    Equity: pickStr(r, "Eq"),
    EquityToAssetRatio: pickStr(r, "EqAR"),
    BookValuePerShare: pickStr(r, "BPS"),
    ResultDividendPerShareAnnual: pickStr(r, "DivAnn"),
    ForecastNetSales: pickStr(r, "FSales"),
    ForecastOperatingProfit: pickStr(r, "FOP"),
    ForecastOrdinaryProfit: pickStr(r, "FOdP"),
    ForecastProfit: pickStr(r, "FNP"),
    ForecastEarningsPerShare: pickStr(r, "FEPS"),
    ForecastDividendPerShareAnnual: pickStr(r, "FDivAnn"),
  };
}

// ---------- API endpoints ----------

export async function listedInfo(): Promise<ListedInfo[]> {
  return fetchAllPaginated<ListedInfo>("/equities/master", {}, mapListedInfo);
}

export async function dailyQuotes(params: {
  code: string;
  from?: string;
  to?: string;
}): Promise<DailyQuote[]> {
  return fetchAllPaginated<DailyQuote>(
    "/equities/bars/daily",
    {
      code: params.code,
      ...(params.from ? { from: params.from } : {}),
      ...(params.to ? { to: params.to } : {}),
    },
    mapDailyQuote,
  );
}

export async function statements(code: string): Promise<StatementRow[]> {
  return fetchAllPaginated<StatementRow>(
    "/fins/summary",
    { code },
    mapStatement,
  );
}
