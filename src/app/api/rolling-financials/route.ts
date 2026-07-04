import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncFinancialsIfStale } from "@/lib/sync";

// Second daily cron: J-Quants is too rate-limited to refresh 1,200 stocks'
// financials in one serverless run, so cycle the ~25 stalest per day
// (25 × 6s pacing ≈ 150s). The full universe rolls over in ~7 weeks, and
// stocks visited in the app refresh themselves on view anyway.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const BATCH = 25;
const DELAY_MS = 6000;

async function run() {
  const stale = await prisma.$queryRaw<{ code: string }[]>`
    SELECT REPLACE(key, 'financials:', '') AS code
    FROM "SyncLog"
    WHERE key LIKE 'financials:%'
    ORDER BY "syncedAt" ASC
    LIMIT ${BATCH}
  `;
  // Backdate so the TTL check inside syncFinancialsIfStale doesn't skip.
  await prisma.$executeRaw`
    UPDATE "SyncLog" SET "syncedAt" = NOW() - INTERVAL '2 days'
    WHERE key IN (SELECT key FROM "SyncLog" WHERE key LIKE 'financials:%' ORDER BY "syncedAt" ASC LIMIT ${BATCH})
  `;

  let synced = 0;
  let failed = 0;
  for (const s of stale) {
    try {
      await syncFinancialsIfStale(s.code);
      synced++;
    } catch {
      failed++;
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
  return NextResponse.json({ requested: stale.length, synced, failed });
}

export async function GET() {
  return run();
}

export async function POST() {
  return run();
}
