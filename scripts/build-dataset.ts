// One Yahoo pass over the universe that serves two purposes:
//  1. Writes a LOCAL 10-year research dataset (.cache/dataset.json) so that
//     strategy research never reads millions of rows from the production DB.
//     (Both 2026 outages were free-tier quota/limit class; dozens of backtest
//     variants against prod is exactly how to cause a third.)
//  2. Backfills PriceCache in the DB from BACKFILL_FROM onward, closing the
//     Jul→Nov 2026 gap left by the outage + the never-refreshed history.
// Run: npx tsx scripts/build-dataset.ts
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { fetchYahoo } from "../src/lib/yahoo-finance";
import { bulkUpsertPriceBars, BENCHMARK_CODE, type PriceRow } from "../src/lib/price-upsert";
import { validBarIndices } from "../src/lib/momentum";

const BACKFILL_FROM = "2026-07-01";
const CONCURRENCY = 6;
const OUT = path.join(__dirname, "..", ".cache", "dataset.json");

type Series = {
  code: string;
  name: string;
  sector: string | null;
  scale: string | null;
  market: string | null;
  t: string[]; // dates
  a: number[]; // adjClose (split+dividend) — for returns
  c: number[]; // close (split-adjusted) — for price levels
  v: number[]; // volume
};

async function main() {
  const stocks = await prisma.listedStock.findMany({
    where: { OR: [{ financials: { some: {} } }, { code: BENCHMARK_CODE }] },
    select: { code: true, name: true, sector33Name: true, scaleCategory: true, marketName: true },
    orderBy: { ticker: "asc" },
  });
  console.log(`universe: ${stocks.length} (incl. benchmark)`);

  const out: Series[] = [];
  const backfill: PriceRow[] = [];
  let cursor = 0;
  let fail = 0;
  async function worker() {
    while (cursor < stocks.length) {
      const s = stocks[cursor++];
      try {
        const q = await fetchYahoo(s.code, "10y", 0);
        const raw = (q?.bars ?? []).filter((b) => Number.isFinite(b.close) && b.close > 0);
        if (raw.length < 60) {
          fail++;
          continue;
        }
        const keep = validBarIndices(raw.map((b) => b.close)).map((i) => raw[i]);
        out.push({
          code: s.code,
          name: s.name,
          sector: s.sector33Name,
          scale: s.scaleCategory,
          market: s.marketName,
          t: keep.map((b) => b.time),
          a: keep.map((b) => b.adjClose ?? b.close),
          c: keep.map((b) => b.close),
          v: keep.map((b) => b.volume ?? 0),
        });
        for (const b of raw) if (b.time >= BACKFILL_FROM) backfill.push({ code: s.code, ...b });
      } catch {
        fail++;
      }
      const done = out.length + fail;
      if (done % 100 === 0) console.log(`  ${done}/${stocks.length} (fail ${fail})`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  out.sort((x, y) => x.code.localeCompare(y.code));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ builtAt: new Date().toISOString(), series: out }));
  const lastDates = out.map((s) => s.t[s.t.length - 1]).sort();
  console.log(
    `dataset: ${out.length} series, fail ${fail}, newest bar ${lastDates.at(-1)}, median last bar ${lastDates[Math.floor(lastDates.length / 2)]}`,
  );
  console.log(`→ ${OUT} (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);

  console.log(`DB backfill: ${backfill.length} bars since ${BACKFILL_FROM} ...`);
  await bulkUpsertPriceBars(backfill);
  console.log("DB backfill done");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
