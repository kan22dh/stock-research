import { prisma } from "./db";
import { listedInfo, dailyQuotes, statements } from "./jquants";
import { toShortCode } from "./stock-codes";
import { extractAnnualSummaries, extractLatestForecast } from "./financial-metrics";

const LISTED_INFO_TTL_MS = 24 * 60 * 60 * 1000;
const PRICES_TTL_MS = 6 * 60 * 60 * 1000;
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

export async function syncPricesIfStale(code: string): Promise<{ count: number; refreshed: boolean }> {
  const key = `prices:${code}`;
  const log = await prisma.syncLog.findUnique({ where: { key } });

  if (log && Date.now() - log.syncedAt.getTime() < PRICES_TTL_MS) {
    const count = await prisma.priceCache.count({ where: { code } });
    if (count > 0) return { count, refreshed: false };
  }

  // Free plan covers ~2 years ending ~12 weeks (84 days) before today.
  // Pull the maximum available window so the chart's "全期間" mode is meaningful.
  const FREE_PLAN_DELAY_DAYS = 90;
  const FREE_PLAN_HISTORY_MONTHS = 24;
  const to = new Date();
  to.setDate(to.getDate() - FREE_PLAN_DELAY_DAYS);
  const from = new Date(to);
  from.setMonth(from.getMonth() - FREE_PLAN_HISTORY_MONTHS);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  const quotes = await dailyQuotes({ code, from: fromStr, to: toStr });

  const valid = quotes.filter(
    (q) =>
      q.Close !== null &&
      q.Open !== null &&
      q.High !== null &&
      q.Low !== null,
  );

  if (valid.length > 0) {
    await prisma.$transaction([
      prisma.priceCache.deleteMany({ where: { code } }),
      prisma.priceCache.createMany({
        data: valid.map((q) => ({
          code,
          date: new Date(q.Date),
          open: q.Open as number,
          high: q.High as number,
          low: q.Low as number,
          close: q.Close as number,
          volume: (q.Volume ?? 0) as number,
        })),
      }),
    ]);
  }

  await prisma.syncLog.upsert({
    where: { key },
    create: { key, payload: String(valid.length) },
    update: { payload: String(valid.length) },
  });

  return { count: valid.length, refreshed: true };
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
