import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncFinancialsIfStale, syncListedInfoIfStale } from "@/lib/sync";

export const maxDuration = 300; // up to 5 min

// J-Quants free plan rate-limits aggressively (~10 req/min observed empirically).
// 6s between calls keeps us safely under the throttle so a 50-batch completes
// without long retry chains.
const BATCH_DELAY_MS = 6000;

export async function POST(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "100"), 500);
  const scaleParam = url.searchParams.get("scale") ?? "small";

  await syncListedInfoIfStale().catch(() => null);

  const scaleFilter =
    scaleParam === "small"
      ? { in: ["TOPIX Small 1", "TOPIX Small 2"] }
      : scaleParam === "mid"
        ? { in: ["TOPIX Mid400"] }
        : scaleParam === "all"
          ? undefined
          : { in: ["TOPIX Small 1", "TOPIX Small 2"] };

  const onlyMissing = url.searchParams.get("only") !== "missing-forecast";
  const stocks = onlyMissing
    ? await prisma.listedStock.findMany({
        where: {
          ...(scaleFilter ? { scaleCategory: scaleFilter } : {}),
          financials: { none: {} },
        },
        select: { code: true },
        take: limit,
        orderBy: { ticker: "asc" },
      })
    : await prisma.listedStock.findMany({
        where: {
          ...(scaleFilter ? { scaleCategory: scaleFilter } : {}),
          financials: { some: {} },
          forecast: null,
        },
        select: { code: true },
        take: limit,
        orderBy: { ticker: "asc" },
      });

  let synced = 0;
  let failed = 0;
  const errors: Array<{ code: string; error: string }> = [];
  for (const s of stocks) {
    try {
      await syncFinancialsIfStale(s.code);
      synced++;
    } catch (e) {
      failed++;
      errors.push({
        code: s.code,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
  }

  return NextResponse.json({
    requested: stocks.length,
    synced,
    failed,
    errors: errors.slice(0, 5), // sample of errors
  });
}
