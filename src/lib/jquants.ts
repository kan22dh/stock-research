import { prisma } from "./db";

const BASE_URL = "https://api.jquants.com/v1";
const ID_TOKEN_TTL_MS = 23 * 60 * 60 * 1000; // 24h - 1h margin

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

type CachedIdToken = {
  idToken: string;
  fetchedAt: number;
};

async function getRefreshToken(): Promise<string> {
  const token = process.env.JQUANTS_REFRESH_TOKEN?.trim();
  if (!token) {
    throw new JQuantsAuthError(
      "JQUANTS_REFRESH_TOKEN が設定されていません。.env を確認してください。",
    );
  }
  return token;
}

async function fetchIdToken(refreshToken: string): Promise<string> {
  const url = `${BASE_URL}/token/auth_refresh?refreshtoken=${encodeURIComponent(refreshToken)}`;
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) {
    const body = await res.text();
    throw new JQuantsAuthError(
      `ID トークン取得失敗 (${res.status}): ${body.slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as { idToken?: string };
  if (!data.idToken) {
    throw new JQuantsAuthError("レスポンスに idToken が含まれていません");
  }
  return data.idToken;
}

async function getIdToken(): Promise<string> {
  const cached = await prisma.syncLog.findUnique({ where: { key: "id_token" } });
  if (cached?.payload) {
    try {
      const parsed = JSON.parse(cached.payload) as CachedIdToken;
      if (Date.now() - parsed.fetchedAt < ID_TOKEN_TTL_MS) {
        return parsed.idToken;
      }
    } catch {
      // fall through and refresh
    }
  }

  const refreshToken = await getRefreshToken();
  const idToken = await fetchIdToken(refreshToken);

  const payload: CachedIdToken = { idToken, fetchedAt: Date.now() };
  await prisma.syncLog.upsert({
    where: { key: "id_token" },
    create: { key: "id_token", payload: JSON.stringify(payload) },
    update: { payload: JSON.stringify(payload) },
  });

  return idToken;
}

async function authedFetch(path: string, params?: Record<string, string>): Promise<unknown> {
  const idToken = await getIdToken();
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (res.status === 401 || res.status === 403) {
    // Token may have expired; clear cache and retry once
    await prisma.syncLog.delete({ where: { key: "id_token" } }).catch(() => {});
    const fresh = await getIdToken();
    const retry = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${fresh}` },
    });
    if (!retry.ok) {
      const body = await retry.text();
      throw new JQuantsApiError(
        `J-Quants API エラー ${retry.status}: ${body.slice(0, 200)}`,
        retry.status,
      );
    }
    return retry.json();
  }
  if (!res.ok) {
    const body = await res.text();
    throw new JQuantsApiError(
      `J-Quants API エラー ${res.status}: ${body.slice(0, 200)}`,
      res.status,
    );
  }
  return res.json();
}

// Pagination helper for endpoints that return pagination_key
async function fetchAllPaginated<T>(
  path: string,
  params: Record<string, string>,
  arrayKey: string,
): Promise<T[]> {
  const all: T[] = [];
  let paginationKey: string | undefined;
  let safety = 0;
  do {
    const res = (await authedFetch(path, {
      ...params,
      ...(paginationKey ? { pagination_key: paginationKey } : {}),
    })) as Record<string, unknown>;
    const arr = res[arrayKey];
    if (Array.isArray(arr)) all.push(...(arr as T[]));
    paginationKey = typeof res.pagination_key === "string" ? res.pagination_key : undefined;
    safety++;
    if (safety > 50) break; // hard ceiling
  } while (paginationKey);
  return all;
}

// ---------- API endpoints ----------

export type ListedInfo = {
  Date: string;
  Code: string; // 5桁
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

export async function listedInfo(): Promise<ListedInfo[]> {
  return fetchAllPaginated<ListedInfo>("/listed/info", {}, "info");
}

export type DailyQuote = {
  Date: string; // "YYYY-MM-DD"
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

export async function dailyQuotes(params: {
  code: string;
  from?: string; // YYYY-MM-DD
  to?: string;
}): Promise<DailyQuote[]> {
  return fetchAllPaginated<DailyQuote>(
    "/prices/daily_quotes",
    {
      code: params.code,
      ...(params.from ? { from: params.from } : {}),
      ...(params.to ? { to: params.to } : {}),
    },
    "daily_quotes",
  );
}

export type StatementRow = {
  DisclosedDate: string;
  DisclosedTime?: string;
  LocalCode: string;
  DisclosureNumber: string;
  TypeOfDocument: string;
  TypeOfCurrentPeriod: string; // "1Q" | "2Q" | "3Q" | "FY"
  CurrentPeriodStartDate: string;
  CurrentPeriodEndDate: string;
  CurrentFiscalYearStartDate: string;
  CurrentFiscalYearEndDate: string;
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
};

export async function statements(code: string): Promise<StatementRow[]> {
  return fetchAllPaginated<StatementRow>(
    "/fins/statements",
    { code },
    "statements",
  );
}
