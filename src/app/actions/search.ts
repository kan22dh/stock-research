"use server";

import { prisma } from "@/lib/db";
import { syncListedInfoIfStale } from "@/lib/sync";

export type StockSearchResult = {
  code: string;
  ticker: string;
  name: string;
  sector33Name: string | null;
  marketName: string | null;
  scaleCategory: string | null;
};

export async function searchStocks(query: string): Promise<StockSearchResult[]> {
  const q = query.trim();
  if (q.length === 0) return [];

  // Lazy sync (no-op if fresh)
  await syncListedInfoIfStale().catch(() => null);

  // SQLite is case-insensitive for ASCII via LIKE; for Japanese names, contains is fine.
  const isNumeric = /^\d+$/u.test(q);

  const results = await prisma.listedStock.findMany({
    where: isNumeric
      ? {
          OR: [
            { ticker: { startsWith: q } },
            { code: { startsWith: q } },
          ],
        }
      : {
          OR: [
            { name: { contains: q } },
            { nameEnglish: { contains: q } },
          ],
        },
    take: 20,
    orderBy: { ticker: "asc" },
  });

  return results.map((r) => ({
    code: r.code,
    ticker: r.ticker,
    name: r.name,
    sector33Name: r.sector33Name,
    marketName: r.marketName,
    scaleCategory: r.scaleCategory,
  }));
}
