// Force re-sync of the TOPIX ETF benchmark (13060) — it has no financials so
// the universe sync skips it. Run: npx tsx scripts/resync-benchmark.ts
import { prisma } from "../src/lib/db";
import { syncPricesIfStale } from "../src/lib/sync";

async function main() {
  await prisma.$executeRaw`UPDATE "SyncLog" SET "syncedAt" = NOW() - INTERVAL '2 days' WHERE key = 'prices:13060'`;
  const r = await syncPricesIfStale("13060");
  console.log("benchmark resynced:", r);
  const bench = await prisma.priceCache.aggregate({
    where: { code: "13060" },
    _count: true,
    _min: { date: true },
  });
  const adj = await prisma.priceCache.count({
    where: { code: "13060", adjClose: { not: null } },
  });
  console.log(
    "bars:",
    bench._count,
    "from",
    bench._min.date?.toISOString().slice(0, 10),
    "adjClose rows:",
    adj,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
