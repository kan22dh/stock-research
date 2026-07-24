import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { listedInfo, statements } from "./jquants";
import { toShortCode } from "./stock-codes";
import { extractAnnualSummaries, extractLatestForecast } from "./financial-metrics";
import { fetchYahoo } from "./yahoo-finance";

const LISTED_INFO_TTL_MS = 24 * 60 * 60 * 1000;
const PRICES_TTL_MS = 24 * 60 * 60 * 1000; // Yahoo-sourced daily bars; refresh ~daily
const FINANCIALS_TTL_MS = 24 * 60 * 60 * 1000;

export async function syncListedInfoIfStale(): Promise<{ count: number; refreshed: boolean }> {
  const log = await prisma.syncLog.findUnique({ where: { key: "listed_info" } });
  if (log && Date.now() - log.syncedAt.getTime() < LISTED_INFO_TTL_MS) {
    const count = await prisma.listedStock.count();
    if (count > 0) return { count, refreshed: false };
  }

  const list = await listedInfo();

  // Bulk upsert in chunks instead of one Prisma call per stock (~4,500
  // individual round-trips) — was both slow and, on a free-tier DB with a
  // metered operation quota, a meaningful chunk of daily usage for a sync
  // that only needs to run once every 24h.
  const CHUNK = 200;
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK);
    const values = chunk.map(
      (row) => Prisma.sql`(
        ${row.Code}, ${toShortCode(row.Code)}, ${row.CompanyName}, ${row.CompanyNameEnglish ?? null},
        ${row.Sector17Code ?? null}, ${row.Sector17CodeName ?? null},
        ${row.Sector33Code ?? null}, ${row.Sector33CodeName ?? null},
        ${row.ScaleCategory ?? null}, ${row.MarketCode ?? null}, ${row.MarketCodeName ?? null}, NOW()
      )`,
    );
    await prisma.$executeRaw`
      INSERT INTO "ListedStock" (
        code, ticker, name, "nameEnglish", "sector17Code", "sector17Name",
        "sector33Code", "sector33Name", "scaleCategory", "marketCode", "marketName", "updatedAt"
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT (code) DO UPDATE SET
        ticker = EXCLUDED.ticker, name = EXCLUDED.name, "nameEnglish" = EXCLUDED."nameEnglish",
        "sector17Code" = EXCLUDED."sector17Code", "sector17Name" = EXCLUDED."sector17Name",
        "sector33Code" = EXCLUDED."sector33Code", "sector33Name" = EXCLUDED."sector33Name",
        "scaleCategory" = EXCLUDED."scaleCategory", "marketCode" = EXCLUDED."marketCode",
        "marketName" = EXCLUDED."marketName", "updatedAt" = EXCLUDED."updatedAt"
    `;
  }

  await prisma.syncLog.upsert({
    where: { key: "listed_info" },
    create: { key: "listed_info", payload: String(list.length) },
    update: { payload: String(list.length) },
  });

  return { count: list.length, refreshed: true };
}

// Prices now come from Yahoo Finance (real-time-ish, 5y history), not J-Quants
// (12-week delayed, 2y window). PriceCache doubles as the backtest data store,
// so we persist the full 5y window.
export async function syncPricesIfStale(code: string): Promise<{ count: number; refreshed: boolean }> {
  const key = `prices:${code}`;
  const log = await prisma.syncLog.findUnique({ where: { key } });

  if (log && Date.now() - log.syncedAt.getTime() < PRICES_TTL_MS) {
    const count = await prisma.priceCache.count({ where: { code } });
    if (count > 0) return { count, refreshed: false };
  }

  // 10y window so the backtest spans multiple regimes (2018 correction,
  // 2020 COVID crash, 2022 bear) instead of one bull market.
  const quote = await fetchYahoo(code, "10y", 3600);
  const bars = quote?.bars ?? [];

  if (bars.length > 0) {
    await prisma.$transaction([
      prisma.priceCache.deleteMany({ where: { code } }),
      prisma.priceCache.createMany({
        data: bars.map((b) => ({
          code,
          date: new Date(b.time),
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          adjClose: b.adjClose,
          volume: b.volume,
        })),
      }),
    ]);
  }

  await prisma.syncLog.upsert({
    where: { key },
    create: { key, payload: String(bars.length) },
    update: { payload: String(bars.length) },
  });

  return { count: bars.length, refreshed: true };
}

export async function syncFinancialsIfStale(
  code: string,
): Promise<{ count: number; refreshed: boolean }> {
  const key = `financials:${code}`;
  const log = await prisma.syncLog.findUnique({ where: { key } });

  if (log && Date.now() - log.syncedAt.getTime() < FINANCIALS_TTL_MS) {
    const count = await prisma.financialCache.count({ where: { code } });
    if (count > 0) return { count, refreshed: false };
  }

  const rows = await statements(code);
  const annual = extractAnnualSummaries(rows);

  // Sort old→new and compute YoY
  const sorted = [...annual].sort((a, b) =>
    a.fiscalYearEnd.localeCompare(b.fiscalYearEnd),
  );

  const records = sorted.map((s, i) => {
    const prev = sorted[i - 1];
    const salesYoY =
      s.netSales != null && prev?.netSales != null && prev.netSales !== 0
        ? ((s.netSales - prev.netSales) / Math.abs(prev.netSales)) * 100
        : null;
    const profitYoY =
      s.netIncome != null && prev?.netIncome != null && prev.netIncome !== 0
        ? ((s.netIncome - prev.netIncome) / Math.abs(prev.netIncome)) * 100
        : null;
    return {
      code,
      fiscalYearEnd: s.fiscalYearEnd,
      netSales: s.netSales,
      operatingProfit: s.operatingProfit,
      ordinaryProfit: s.ordinaryProfit,
      netIncome: s.netIncome,
      eps: s.eps,
      totalAssets: s.totalAssets,
      equity: s.equity,
      equityRatio: s.equityRatio,
      bookValuePerShare: s.bookValuePerShare,
      dividend: s.dividend,
      salesYoY,
      profitYoY,
    };
  });

  // Latest forecast (separate table)
  const forecast = extractLatestForecast(rows);
  let forecastSalesYoY: number | null = null;
  let forecastProfitYoY: number | null = null;
  if (forecast) {
    const latestActual = sorted[sorted.length - 1];
    if (
      forecast.netSales != null &&
      latestActual?.netSales != null &&
      latestActual.netSales !== 0
    ) {
      forecastSalesYoY =
        ((forecast.netSales - latestActual.netSales) /
          Math.abs(latestActual.netSales)) *
        100;
    }
    if (
      forecast.netIncome != null &&
      latestActual?.netIncome != null &&
      latestActual.netIncome !== 0
    ) {
      forecastProfitYoY =
        ((forecast.netIncome - latestActual.netIncome) /
          Math.abs(latestActual.netIncome)) *
        100;
    }
  }

  await prisma.$transaction([
    prisma.financialCache.deleteMany({ where: { code } }),
    ...(records.length > 0
      ? [prisma.financialCache.createMany({ data: records })]
      : []),
    prisma.forecast.deleteMany({ where: { code } }),
    ...(forecast
      ? [
          prisma.forecast.create({
            data: {
              code,
              forFiscalYearEnd: forecast.forFiscalYearEnd,
              disclosedDate: forecast.disclosedDate,
              netSales: forecast.netSales,
              operatingProfit: forecast.operatingProfit,
              ordinaryProfit: forecast.ordinaryProfit,
              netIncome: forecast.netIncome,
              eps: forecast.eps,
              dividendAnnual: forecast.dividendAnnual,
              salesYoYImplied: forecastSalesYoY,
              profitYoYImplied: forecastProfitYoY,
            },
          }),
        ]
      : []),
  ]);

  await prisma.syncLog.upsert({
    where: { key },
    create: {
      key,
      payload: JSON.stringify({
        annual: records.length,
        forecast: forecast ? 1 : 0,
      }),
    },
    update: {
      payload: JSON.stringify({
        annual: records.length,
        forecast: forecast ? 1 : 0,
      }),
    },
  });

  return { count: records.length, refreshed: true };
}
