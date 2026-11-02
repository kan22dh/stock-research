import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncMomentumBatchConcurrent } from "@/lib/momentum-sync";
import {
  takeMomentumSnapshot,
  computeDailySignals,
  jstToday,
} from "@/lib/signals";
import { runPaperAutopilot } from "@/lib/paper-autopilot";
import { syncBenchmarkRecent } from "@/lib/price-upsert";
import { runStage, startCronRun, finishCronRun, type StageResult } from "@/lib/cron-run";

// Morning cron (see vercel.json): snapshot yesterday's VCP state, refresh
// momentum (+ recent PriceCache bars) for the whole universe, refresh the
// TOPIX ETF benchmark, diff into the day's signal feed, then let the paper
// account trade. Idempotent — safe to re-run; ?force=1 bypasses the TTL.
//
// Every stage is isolated (cron-run.ts): before 2026-11 one throw anywhere
// skipped everything after it, including marking paper equity, and left no
// trace. A failed stage now shows up in CronRun / /api/health instead.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function run(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const t0 = Date.now();
  const runId = await startCronRun("daily-refresh");
  const stages: Record<string, StageResult> = {};

  if (force) {
    await runStage(stages, "force", () =>
      prisma.$executeRaw`UPDATE "Momentum" SET "asOf" = NOW() - INTERVAL '2 days'`,
    );
  }

  const snapshot = await runStage(stages, "snapshot", takeMomentumSnapshot);

  await runStage(stages, "momentum", async () => {
    const stocks = await prisma.listedStock.findMany({
      where: { financials: { some: {} } },
      select: { code: true },
      orderBy: { ticker: "asc" },
    });
    return syncMomentumBatchConcurrent(
      stocks.map((s) => s.code),
      8,
    );
  });

  await runStage(stages, "benchmark", syncBenchmarkRecent);

  // Signals diff against the pre-refresh snapshot; without one there is
  // nothing to diff, so skip rather than emit a bogus all-new feed.
  if (snapshot) {
    await runStage(stages, "signals", () => computeDailySignals(snapshot));
  }

  // L3: the simulated account(s). Runs even if an earlier stage failed —
  // stale-by-a-day prices are better than an unmarked equity curve.
  await runStage(stages, "autopilot", runPaperAutopilot);

  const ok = await finishCronRun(runId, stages);
  return NextResponse.json(
    {
      date: jstToday(),
      ok,
      elapsedSec: Math.round((Date.now() - t0) / 1000),
      stages,
    },
    { status: ok ? 200 : 500 },
  );
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
