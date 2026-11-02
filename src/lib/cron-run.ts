// Cron run log + per-stage fault isolation.
//
// Before 2026-11 a single throw anywhere in /api/daily-refresh (Yahoo
// timeout, DB hiccup) killed every later stage — including marking the paper
// account's equity — and left no record. The 2026-08-12 → 10-02 outage was
// only discovered by noticing a 7-week hole in PaperEquity. Now each stage
// runs in isolation and the outcome of every run is persisted, so a failure
// is (a) contained to its stage and (b) visible to /api/health and the
// GitHub Actions watchdog that polls it.

import { prisma } from "./db";

export type StageResult =
  | { ok: true; ms: number; result: unknown }
  | { ok: false; ms: number; error: string };

export async function runStage<T>(
  stages: Record<string, StageResult>,
  name: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const t0 = Date.now();
  try {
    const result = await fn();
    stages[name] = { ok: true, ms: Date.now() - t0, result };
    return result;
  } catch (e) {
    stages[name] = {
      ok: false,
      ms: Date.now() - t0,
      error: e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500),
    };
    return null;
  }
}

export async function startCronRun(job: string): Promise<number | null> {
  // Logging must never be the thing that takes the cron down.
  try {
    const row = await prisma.cronRun.create({ data: { job } });
    return row.id;
  } catch {
    return null;
  }
}

export async function finishCronRun(
  id: number | null,
  stages: Record<string, StageResult>,
): Promise<boolean> {
  const ok = Object.values(stages).every((s) => s.ok);
  if (id == null) return ok;
  try {
    await prisma.cronRun.update({
      where: { id },
      data: { finishedAt: new Date(), ok, detail: JSON.stringify(stages) },
    });
  } catch {
    // swallow — see startCronRun
  }
  return ok;
}
