// Force-refresh Momentum rows (RS raw, Trend Template, VCP) for every stock
// with financials, bypassing the 20h TTL by backdating asOf first.
// Run: npx tsx scripts/refresh-momentum.ts
import { prisma } from "../src/lib/db";
import { syncMomentumBatch } from "../src/lib/momentum-sync";

async function main() {
  await prisma.$executeRaw`UPDATE "Momentum" SET "asOf" = NOW() - INTERVAL '2 days'`;
  const stocks = await prisma.listedStock.findMany({
    where: { financials: { some: {} } },
    select: { code: true },
    orderBy: { ticker: "asc" },
  });
  console.log(`refreshing momentum for ${stocks.length} stocks...`);
  const r = await syncMomentumBatch(
    stocks.map((s) => s.code),
    150,
  );
  console.log(`done: synced=${r.synced} failed=${r.failed}`);
  const vcp = await prisma.momentum.count({ where: { vcpPass: true } });
  const tt = await prisma.momentum.count({ where: { technicalPass: true } });
  console.log(`vcpPass=${vcp} technicalPass=${tt}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
