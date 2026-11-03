// Data-pipeline health, shared by /api/health (polled by the GitHub Actions
// watchdog, which emails the owner on failure) and the on-page badge.
//
// "Fresh" is judged against the cron SCHEDULE, not a flat hour count: the
// cron runs Mon–Fri 07:00 JST, so a Monday 06:00 check legitimately sees
// Friday's data (~71h old). A flat 30h threshold false-alarms every weekend,
// and false alarms teach people to ignore the alarm.

import { prisma } from "./db";
import { BENCHMARK_CODE } from "./price-upsert";

const JST_OFFSET_MS = 9 * 3600 * 1000;
const RUN_HOUR_JST = 7;
const GRACE_MS = 90 * 60 * 1000; // cron start jitter + up to 5 min runtime

// Most recent scheduled run time (Mon–Fri hourJst:00 JST) at or before `now`.
// Default = the 07:00 morning cron; the v2 guard job runs at 17:00.
export function lastScheduledRun(now = new Date(), hourJst = RUN_HOUR_JST): Date {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const d = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), hourJst));
  // d is "07:00 on the JST calendar day", expressed in shifted-UTC space.
  if (d.getTime() > jst.getTime()) d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return new Date(d.getTime() - JST_OFFSET_MS);
}

export type HealthCheck = { name: string; ok: boolean; detail: string };
export type Health = { ok: boolean; checkedAt: string; expectedRunAfter: string; checks: HealthCheck[] };

function fmtJst(d: Date | null | undefined): string {
  if (!d) return "なし";
  return new Date(d.getTime() + JST_OFFSET_MS).toISOString().replace("T", " ").slice(0, 16) + " JST";
}

export async function computeHealth(now = new Date()): Promise<Health> {
  const scheduled = lastScheduledRun(now);
  // Within the grace window right after 07:00 the run may still be in
  // flight — judge against the previous scheduled slot instead.
  const mustHaveRunAfter =
    now.getTime() - scheduled.getTime() < GRACE_MS
      ? lastScheduledRun(new Date(scheduled.getTime() - 60_000))
      : scheduled;
  // Data rows carry the run's own timestamp, which can be a few minutes
  // BEFORE the scheduled minute if Vercel fires early; allow 30 min slack.
  const threshold = new Date(mustHaveRunAfter.getTime() - 30 * 60 * 1000);

  const [lastOk, lastAny, momentum, bench, equity] = await Promise.all([
    prisma.cronRun.findFirst({
      where: { job: "daily-refresh", ok: true },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    }),
    prisma.cronRun.findFirst({
      where: { job: "daily-refresh" },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true, ok: true, detail: true },
    }),
    prisma.momentum.findFirst({ orderBy: { asOf: "desc" }, select: { asOf: true } }),
    prisma.priceCache.findFirst({
      where: { code: BENCHMARK_CODE },
      orderBy: { date: "desc" },
      select: { date: true },
    }),
    prisma.paperEquity.findFirst({ orderBy: { date: "desc" }, select: { date: true } }),
  ]);

  const checks: HealthCheck[] = [];

  checks.push({
    name: "cron",
    ok: !!lastOk && lastOk.startedAt >= threshold,
    detail: `最終成功 ${fmtJst(lastOk?.startedAt)}` +
      (lastAny && !lastAny.ok
        ? ` / 直近の実行 ${fmtJst(lastAny.startedAt)} は失敗: ${failedStages(lastAny.detail)}`
        : ""),
  });
  checks.push({
    name: "momentum",
    ok: !!momentum && momentum.asOf >= threshold,
    detail: `最終更新 ${fmtJst(momentum?.asOf)}`,
  });
  // Market bars are dated by trading day (UTC midnight). The newest bar
  // should be no older than ~4 calendar days before the expected run
  // (covers a weekend plus one exchange holiday).
  const benchFloor = new Date(mustHaveRunAfter.getTime() - 4 * 86400_000);
  checks.push({
    name: "benchmark",
    ok: !!bench && bench.date >= benchFloor,
    detail: `TOPIX ETF最新足 ${bench?.date.toISOString().slice(0, 10) ?? "なし"}`,
  });
  const expectedJstDate = new Date(mustHaveRunAfter.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
  checks.push({
    name: "paper",
    ok: !!equity && equity.date >= expectedJstDate,
    detail: `仮想口座の最終評価日 ${equity?.date ?? "なし"}`,
  });

  // v2 guard account: evening job, Mon–Fri 17:00–17:59 JST (Vercel Hobby
  // fires anywhere within the hour). Judged against its own slot, and not
  // required before the account's first run exists.
  const GUARD_HOUR = 17;
  const gSlot = lastScheduledRun(now, GUARD_HOUR);
  const gMustAfter =
    now.getTime() - gSlot.getTime() < GRACE_MS ? lastScheduledRun(new Date(gSlot.getTime() - 60_000), GUARD_HOUR) : gSlot;
  const [gLastOk, gAny] = await Promise.all([
    prisma.cronRun.findFirst({ where: { job: "guard-evening", ok: true }, orderBy: { startedAt: "desc" }, select: { startedAt: true } }),
    prisma.cronRun.findFirst({ where: { job: "guard-evening" }, select: { id: true } }),
  ]);
  if (gAny) {
    checks.push({
      name: "guard",
      ok: !!gLastOk && gLastOk.startedAt >= new Date(gMustAfter.getTime() - 30 * 60 * 1000),
      detail: `v2夕方ジョブ 最終成功 ${fmtJst(gLastOk?.startedAt)}(予定 ${fmtJst(gMustAfter)} 以降)`,
    });
  }

  return {
    ok: checks.every((c) => c.ok),
    checkedAt: fmtJst(now),
    expectedRunAfter: fmtJst(mustHaveRunAfter),
    checks,
  };
}

function failedStages(detail: string | null): string {
  if (!detail) return "詳細なし";
  try {
    const stages = JSON.parse(detail) as Record<string, { ok: boolean; error?: string }>;
    return (
      Object.entries(stages)
        .filter(([, s]) => !s.ok)
        .map(([k, s]) => `${k}(${s.error ?? "?"})`)
        .join(", ") || "詳細なし"
    );
  } catch {
    return "詳細なし";
  }
}
