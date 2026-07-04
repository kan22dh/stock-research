import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncMomentumBatchConcurrent } from "@/lib/momentum-sync";
import {
  takeMomentumSnapshot,
  computeDailySignals,
  jstToday,
} from "@/lib/signals";

// Morning cron (see vercel.json): snapshot yesterday's VCP state, refresh
// momentum for the whole universe, then diff into the day's signal feed.
// Idempotent — safe to re-run; ?force=1 bypasses the momentum TTL.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function run(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const t0 = Date.now();

  if (force) {
    await prisma.$executeRaw`UPDATE "Momentum" SET "asOf" = NOW() - INTERVAL '2 days'`;
  }

  const snapshot = await takeMomentumSnapshot();

  const stocks = await prisma.listedStock.findMany({
    where: { financials: { some: {} } },
    select: { code: true },
    orderBy: { ticker: "asc" },
  });
  const sync = await syncMomentumBatchConcurrent(
    stocks.map((s) => s.code),
    8,
  );

  const signals = await computeDailySignals(snapshot);

  return NextResponse.json({
    date: jstToday(),
    elapsedSec: Math.round((Date.now() - t0) / 1000),
    momentum: sync,
    signals,
  });
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
