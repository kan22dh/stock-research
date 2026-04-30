import { prisma } from "./db";
import { listedInfo, dailyQuotes } from "./jquants";
import { toShortCode } from "./stock-codes";

const LISTED_INFO_TTL_MS = 24 * 60 * 60 * 1000; // sync once per day
const PRICES_TTL_MS = 6 * 60 * 60 * 1000;

export async function syncListedInfoIfStale(): Promise<{ count: number; refreshed: boolean }> {
  const log = await prisma.syncLog.findUnique({ where: { key: "listed_info" } });
  if (log && Date.now() - log.syncedAt.getTime() < LISTED_INFO_TTL_MS) {
    const count = await prisma.listedStock.count();
    if (count > 0) return { count, refreshed: false };
  }

  const list = await listedInfo();

  // Bulk upsert via transaction (sqlite handles modest sizes fine; ~4000 rows expected)
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

  // Free plan: 12 weeks delay, max 12 months window
  // Pull a wide window (1 year) and let API return what it has
  const to = new Date();
  const from = new Date();
  from.setFullYear(from.getFullYear() - 1);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  const quotes = await dailyQuotes({ code, from: fromStr, to: toStr });

  // Filter rows with valid OHLC (sometimes adjusted fields are null on holidays etc.)
  const valid = quotes.filter(
    (q) =>
      q.Close !== null &&
      q.Open !== null &&
      q.High !== null &&
      q.Low !== null,
  );

  if (valid.length > 0) {
    // Replace cache for this code
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
