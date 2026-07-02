// Force re-sync of PriceCache for every stock with financials (+ benchmark),
// bypassing the 24h TTL by backdating the SyncLog rows first. Needed whenever
// the price pipeline changes (e.g. 5y→10y window, adjClose addition).
// Run: npx tsx scripts/refresh-prices.ts
import { prisma } from "../src/lib/db";
import { syncPricesIfStale } from "../src/lib/sync";

const DELAY_MS = 150;

async function main() {
  await prisma.$executeRaw`UPDATE "SyncLog" SET "syncedAt" = NOW() - INTERVAL '2 days' WHERE "key" LIKE 'prices:%'`;
  const stocks = await prisma.listedStock.findMany({
    where: { financials: { some: {} } },
    select: { code: true },
    orderBy: { ticker: "asc" },
  });
  const codes = stocks.map((s) => s.code);
  if (!codes.includes("13060")) codes.unshift("13060"); // benchmark ETF

  console.log(`re-syncing prices (10y, adjClose) for ${codes.length} stocks...`);
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < codes.length; i++) {
    try {
      await syncPricesIfStale(codes[i]);
      ok++;
    } catch {
      fail++;
    }
    if ((i + 1) % 100 === 0)
      console.log(`progress ${i + 1}/${codes.length} (ok=${ok} fail=${fail})`);
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
  console.log(`done: ok=${ok} fail=${fail}`);
  const withAdj = await prisma.priceCache.count({ where: { adjClose: { not: null } } });
  const total = await prisma.priceCache.count();
  console.log(`rows with adjClose: ${withAdj}/${total}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
