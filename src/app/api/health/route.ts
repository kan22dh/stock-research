import { NextResponse } from "next/server";
import { computeHealth } from "@/lib/health";

// Polled by .github/workflows/watchdog.yml. Non-200 → the workflow run fails
// → GitHub emails the repo owner. That is the whole alerting system, and it
// costs nothing (public-repo / free-tier Actions minutes).
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const health = await computeHealth();
    return NextResponse.json(health, { status: health.ok ? 200 : 503 });
  } catch (e) {
    // DB unreachable (quota, outage) is the most important case to report.
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 503 },
    );
  }
}
