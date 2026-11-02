import { connection } from "next/server";
import { computeHealth } from "@/lib/health";

// Surfaces when the daily cron has silently stopped updating data. Two real
// incidents shaped this: 2026-07 (DB quota hit; ISR kept serving 12-day-old
// pages) and 2026-08-12 → 10-02 (cron dead 7 weeks, benchmark frozen since
// 07-24, nobody noticed). The badge only helps if someone opens the page, so
// the same check also backs /api/health, which a GitHub Actions watchdog
// polls every weekday morning and emails on failure.
//
// Requires force-dynamic pages (see page.tsx) — an ISR-cached page would
// freeze this component's verdict at the last successful revalidation.
export async function SystemHealthBadge() {
  await connection();

  let health;
  try {
    health = await computeHealth();
  } catch (e) {
    return (
      <div className="rounded-lg border-2 border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-300">
        <div className="font-semibold">⚠ データベースに接続できません</div>
        <div className="mt-1 text-xs">{e instanceof Error ? e.message.slice(0, 200) : String(e)}</div>
      </div>
    );
  }
  if (health.ok) return null;

  const LABEL: Record<string, string> = {
    cron: "毎朝の自動実行",
    momentum: "株価モメンタム",
    benchmark: "TOPIX(比較基準)",
    paper: "仮想口座の評価",
  };
  const failing = health.checks.filter((c) => !c.ok);

  return (
    <div className="rounded-lg border-2 border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-300">
      <div className="font-semibold">
        ⚠ 自動更新に問題があります({failing.map((c) => LABEL[c.name] ?? c.name).join("・")})
      </div>
      <ul className="mt-1 text-xs space-y-0.5">
        {failing.map((c) => (
          <li key={c.name}>
            {LABEL[c.name] ?? c.name}: {c.detail}
          </li>
        ))}
      </ul>
      <div className="mt-1 text-xs">
        {health.expectedRunAfter} 以降の実行が見当たりません。
        <a
          href="/api/daily-refresh"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-red-900 dark:hover:text-red-200"
        >
          手動で今すぐ再実行
        </a>
        できます(1〜2分)。詳細は
        <a href="/api/health" className="underline mx-1" target="_blank" rel="noopener noreferrer">
          /api/health
        </a>
        。
      </div>
    </div>
  );
}
