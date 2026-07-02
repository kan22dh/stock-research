import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncPricesIfStale } from "@/lib/sync";

export const maxDuration = 300; // up to 5 min

// Yahoo-sourced, so pacing can be light. Each call persists ~5y of daily bars
// into PriceCache — the backtest data store.
const BATCH_DELAY_MS = 150;

export async function POST(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "200"), 1000);

  // Universe: stocks with financials (our investable set) + the TOPIX ETF
  // benchmark (13060) used by the backtest.
  const stocks = await prisma.listedStock.findMany({
    where: { financials: { some: {} } },
    select: { code: true },
    take: limit,
    orderBy: { ticker: "asc" },
  });
  const codes = stocks.map((s) => s.code);
  const benchmark = await prisma.listedStock.findUnique({
    where: { code: "13060" },
    select: { code: true },
  });
  if (benchmark && !codes.includes(benchmark.code)) codes.unshift(benchmark.code);

  let synced = 0;
  let skipped = 0;
  let failed = 0;
  for (const code of codes) {
    try {
      const r = await syncPricesIfStale(code);
      if (r.refreshed) synced++;
      else skipped++;
    } catch {
      failed++;
    }
    await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
  }

  return NextResponse.json({ requested: codes.length, synced, skipped, failed });
}
