import { NextResponse } from "next/server";
import { runGuardEvening } from "@/lib/guard-account";
import { runStage, startCronRun, finishCronRun, type StageResult } from "@/lib/cron-run";

// Evening cron for the v2「年間損失上限型」paper account (vercel.json:
// 08:00 UTC = 17:00–17:59 JST on weekdays, after the 15:30 close). Writes
// tonight's order sheet for /guard. A market holiday is a successful no-op.
// Idempotent; ?force=1 re-marks today.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function run(req: Request) {
  const force = new URL(req.url).searchParams.get("force") === "1";
  const runId = await startCronRun("guard-evening");
  const stages: Record<string, StageResult> = {};
  const result = await runStage(stages, "guard", () => runGuardEvening({ force }));
  const ok = await finishCronRun(runId, stages);
  return NextResponse.json({ ok, result, stages }, { status: ok ? 200 : 500 });
}

export async function GET(req: Request) {
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}
