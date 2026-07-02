// Long-running universe sync: fetch financials (J-Quants, 6s pacing) for all
// small caps missing them, then prices + momentum (Yahoo, fast) for each.
// Writes straight to the shared Postgres, so production picks results up
// immediately. Run: npx tsx scripts/sync-universe.ts
import { prisma } from "../src/lib/db";
import { syncFinancialsIfStale, syncPricesIfStale } from "../src/lib/sync";
import { syncMomentumIfStale } from "../src/lib/momentum-sync";

const FINANCIALS_DELAY_MS = 6000; // J-Quants free plan pacing
const FAST_DELAY_MS = 150; // Yahoo pacing

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main() {
  const missing = await prisma.listedStock.findMany({
    where: {
      scaleCategory: { in: ["TOPIX Small 1", "TOPIX Small 2"] },
      financials: { none: {} },
    },
    select: { code: true, ticker: true },
    orderBy: { ticker: "asc" },
  });
  log(`small caps missing financials: ${missing.length}`);

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < missing.length; i++) {
    const s = missing[i];
    try {
      await syncFinancialsIfStale(s.code);
      ok++;
    } catch (e) {
      fail++;
      log(`financials FAIL ${s.ticker}: ${e instanceof Error ? e.message.slice(0, 80) : e}`);
    }
    if ((i + 1) % 25 === 0) log(`financials progress ${i + 1}/${missing.length} (ok=${ok} fail=${fail})`);
    await new Promise((r) => setTimeout(r, FINANCIALS_DELAY_MS));
  }
  log(`financials done: ok=${ok} fail=${fail}`);

  // Prices + momentum for everything that now has financials but lacks them.
  const withFin = await prisma.listedStock.findMany({
    where: { financials: { some: {} } },
    select: { code: true },
    orderBy: { ticker: "asc" },
  });
  log(`prices+momentum pass over ${withFin.length} stocks`);
  let pOk = 0;
  let pFail = 0;
  for (let i = 0; i < withFin.length; i++) {
    try {
      await syncPricesIfStale(withFin[i].code);
      await syncMomentumIfStale(withFin[i].code);
      pOk++;
    } catch {
      pFail++;
    }
    if ((i + 1) % 100 === 0) log(`prices/momentum progress ${i + 1}/${withFin.length}`);
    await new Promise((r) => setTimeout(r, FAST_DELAY_MS));
  }
  log(`prices+momentum done: ok=${pOk} fail=${pFail}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
