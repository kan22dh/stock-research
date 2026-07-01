import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncMomentumBatch } from "@/lib/momentum-sync";

export const maxDuration = 300; // up to 5 min

// Yahoo has no meaningful rate limit, so batches can be larger/faster than
// the J-Quants financial sync.
const BATCH_DELAY_MS = 150;

export async function POST(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "200"), 1000);
  const scaleParam = url.searchParams.get("scale") ?? "financials";

  // Default universe: stocks we already have financials for (our investable
  // set) — momentum without fundamentals isn't actionable for this app.
  const where =
    scaleParam === "all"
      ? {}
      : scaleParam === "small"
        ? { scaleCategory: { in: ["TOPIX Small 1", "TOPIX Small 2"] } }
        : { financials: { some: {} } };

  const stocks = await prisma.listedStock.findMany({
    where,
    select: { code: true },
    take: limit,
    orderBy: { ticker: "asc" },
  });

  const result = await syncMomentumBatch(
    stocks.map((s) => s.code),
    BATCH_DELAY_MS,
  );

  return NextResponse.json(result);
}
