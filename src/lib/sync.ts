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

  await prisma.$transaction(
    list.map((row) =>
      prisma.listedStock.upsert({
        where: { code: row.Code },
        create: {
          code: row.Code,
          ticker: toShortCode(row.Code),
          name: row.CompanyName,
          nameEnglish: row.CompanyNameEnglish ?? null,
          sector17Code: row.Sector17Code ?? null,
          sector17Name: row.Sector17CodeName ?? null,
          sector33Code: row.Sector33Code ?? null,
          sector33Name: row.Sector33CodeName ?? null,
          scaleCategory: row.ScaleCategory ?? null,
          marketCode: row.MarketCode ?? null,
          marketName: row.MarketCodeName ?? null,
        },
        update: {
          ticker: toShortCode(row.Code),
          name: row.CompanyName,
          nameEnglish: row.CompanyNameEnglish ?? null,
          sector17Code: row.Sector17Code ?? null,
          sector17Name: row.Sector17CodeName ?? null,
          sector33Code: row.Sector33Code ?? null,
          sector33Name: row.Sector33CodeName ?? null,
          scaleCategory: row.ScaleCategory ?? null,
          marketCode: row.MarketCode ?? null,
          marketName: row.MarketCodeName ?? null,
        },
      }),
    ),
  );

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

  const quote = await fetchYahoo(code, "5y", 3600);
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
