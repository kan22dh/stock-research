// Incremental PriceCache maintenance.
//
// syncPricesIfStale() rewrites a stock's whole 10-year history (~2,450 rows)
// and only runs when someone opens that stock's page, so by 2026-11 only 140
// of ~1,270 stocks had bars after July and the TOPIX ETF benchmark had frozen
// on 07-24 (it has no financials, so the universe sync never touched it). The
// backtest, the monthly reviews and the withdrawal rule all read PriceCache,
// so all three were silently running on stale data.
//
// This path upserts only recent bars (ON CONFLICT on the (code, date) primary
// key), in chunks, so keeping every stock current costs a handful of
// statements per day instead of millions of row rewrites.

import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { fetchYahoo, type YahooBar } from "./yahoo-finance";

export const BENCHMARK_CODE = "13060"; // TOPIX連動ETF (1306)

export type PriceRow = { code: string } & YahooBar;

const CHUNK = 500;

export async function bulkUpsertPriceBars(rows: PriceRow[]): Promise<number> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = chunk.map(
      (r) =>
        Prisma.sql`(${r.code}, ${new Date(`${r.time}T00:00:00Z`)}, ${r.open}, ${r.high}, ${r.low}, ${r.close}, ${r.adjClose}, ${r.volume})`,
    );
    await prisma.$executeRaw`
      INSERT INTO "PriceCache" (code, date, open, high, low, close, "adjClose", volume)
      VALUES ${Prisma.join(values)}
      ON CONFLICT (code, date) DO UPDATE SET
        open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
        close = EXCLUDED.close, "adjClose" = EXCLUDED."adjClose", volume = EXCLUDED.volume
    `;
  }
  return rows.length;
}

// The benchmark gets a 3-month window every day: cheap (one stock), and it
// self-heals any gap shorter than that without a manual resync.
export async function syncBenchmarkRecent(): Promise<{ bars: number; latest: string | null }> {
  const q = await fetchYahoo(BENCHMARK_CODE, "3mo", 0);
  const bars = (q?.bars ?? []).filter(
    (b) => Number.isFinite(b.close) && b.close > 0,
  );
  if (bars.length === 0) throw new Error("benchmark: Yahoo returned no bars");
  await bulkUpsertPriceBars(bars.map((b) => ({ code: BENCHMARK_CODE, ...b })));
  return { bars: bars.length, latest: bars[bars.length - 1].time };
}
