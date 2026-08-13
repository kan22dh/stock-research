import { prisma } from "@/lib/db";
import { connection } from "next/server";

// Surfaces when the daily cron has silently stopped updating data — the
// exact failure mode from the 2026-07 incident (DB hit its free-tier quota,
// all writes/reads blocked, but ISR-cached pages kept serving 12-day-old
// "200 OK" snapshots with no visible sign anything was wrong for ~2 weeks).
//
// This only works because the pages that render it are force-dynamic (see
// page.tsx `export const dynamic`) — an ISR-cached page would freeze this
// component's "N日前" text at whatever it was on the last successful
// revalidation, silently lying forever once revalidation starts failing.
const STALE_THRESHOLD_HOURS = 30; // cron runs ~daily; missing ~1.5 days = alarm

export async function SystemHealthBadge() {
  // The badge depends on the request time, so it must never be frozen during
  // prerendering. This is the Next.js 16 replacement for unstable_noStore().
  await connection();

  const momentum = await prisma.momentum.findFirst({
    orderBy: { asOf: "desc" },
    select: { asOf: true },
  });

  const ageHours = momentum
    // React's purity rule cannot infer that connection() makes this a
    // request-time Server Component; reading the clock here is intentional.
    // eslint-disable-next-line react-hooks/purity
    ? (Date.now() - momentum.asOf.getTime()) / 3_600_000
    : Infinity;
  if (ageHours < STALE_THRESHOLD_HOURS) return null;

  const daysAgo = momentum ? (ageHours / 24).toFixed(1) : null;
  const lastUpdateStr = momentum
    ? momentum.asOf.toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

  return (
    <div className="rounded-lg border-2 border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-300">
      <div className="font-semibold">
        {momentum
          ? `⚠ 毎朝の自動更新が${daysAgo}日間止まっている可能性があります`
          : "⚠ モメンタムデータがまだありません(初回同期が未完了)"}
      </div>
      <div className="mt-1 text-xs">
        {momentum
          ? `最終モメンタム更新: ${lastUpdateStr}(JST)`
          : "データ復旧の初回同期が進行中の可能性があります。数時間後に再確認してください。"}
        。Vercelダッシュボードの Cron Jobs / Deployments でエラーを確認するか、
        <a
          href="/api/daily-refresh"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-red-900 dark:hover:text-red-200"
        >
          手動で今すぐ再実行
        </a>
        してください(1〜2分かかります)。
      </div>
    </div>
  );
}
