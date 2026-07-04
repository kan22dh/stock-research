import Link from "next/link";
import { prisma } from "@/lib/db";

// Home feed of the latest cron-generated signals (pivot breakouts, new VCP
// setups, stop-raise suggestions). Renders nothing until the first cron run.
export async function SignalsFeed() {
  const latest = await prisma.signal.findFirst({
    orderBy: { date: "desc" },
    select: { date: true },
  });
  if (!latest) return null;

  const signals = await prisma.signal.findMany({
    where: { date: latest.date },
    include: { stock: true },
    orderBy: { type: "asc" },
  });
  if (signals.length === 0) return null;

  const parse = (s: string | null): Record<string, number | null> => {
    try {
      return s ? JSON.parse(s) : {};
    } catch {
      return {};
    }
  };
  const breakouts = signals.filter((s) => s.type === "pivot_breakout");
  const newSetups = signals.filter((s) => s.type === "vcp_new");
  const stopRaises = signals.filter((s) => s.type === "stop_raise");

  return (
    <section className="rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/60 dark:bg-indigo-950/20 p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-indigo-900 dark:text-indigo-300">
          📣 今日のシグナル
        </h2>
        <span className="text-xs text-neutral-500">
          {latest.date} 朝の自動スキャン(毎朝7時更新)
        </span>
      </div>

      {breakouts.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            🚀 ピボット・ブレイクアウト({breakouts.length}件) — エントリー条件成立
          </div>
          <ul className="space-y-1">
            {breakouts.map((s) => {
              const p = parse(s.payload);
              return (
                <li key={s.id} className="text-sm">
                  <Link href={`/stocks/${s.code}`} className="font-medium hover:underline">
                    {s.stock.ticker} {s.stock.name}
                  </Link>{" "}
                  <span className="text-neutral-600 dark:text-neutral-400">
                    — 終値¥{Math.round(Number(p.price ?? 0)).toLocaleString()}がピボット¥
                    {Math.round(Number(p.pivot ?? 0)).toLocaleString()}を上抜け(+
                    {Number(p.movePct ?? 0).toFixed(1)}%)。出来高と地合いを確認の上、買うなら損切りは買値-7〜8%
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {newSetups.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-indigo-700 dark:text-indigo-400">
            🧨 新規VCP形成({newSetups.length}件) — 監視リスト入り候補
          </div>
          <ul className="space-y-1">
            {newSetups.slice(0, 8).map((s) => {
              const p = parse(s.payload);
              return (
                <li key={s.id} className="text-sm">
                  <Link href={`/stocks/${s.code}`} className="font-medium hover:underline">
                    {s.stock.ticker} {s.stock.name}
                  </Link>{" "}
                  <span className="text-neutral-600 dark:text-neutral-400">
                    — ピボット¥{Math.round(Number(p.pivot ?? 0)).toLocaleString()}超え待ち
                  </span>
                </li>
              );
            })}
          </ul>
          {newSetups.length > 8 && (
            <Link href="/screener?vcp=1&sort=rs" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
              他{newSetups.length - 8}件をスクリーナーで見る →
            </Link>
          )}
        </div>
      )}

      {stopRaises.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-amber-700 dark:text-amber-400">
            ⬆ 損切り引き上げ提案({stopRaises.length}件) — 利益の保護
          </div>
          <ul className="space-y-1">
            {stopRaises.map((s) => {
              const p = parse(s.payload);
              return (
                <li key={s.id} className="text-sm">
                  <Link href={`/stocks/${s.code}`} className="font-medium hover:underline">
                    {s.stock.ticker} {s.stock.name}
                  </Link>{" "}
                  <span className="text-neutral-600 dark:text-neutral-400">
                    — 取得比+{Number(p.gainPct ?? 0).toFixed(1)}%。損切りを
                    {p.currentStop != null
                      ? `¥${Number(p.currentStop).toLocaleString()}→`
                      : ""}
                    ¥{Number(p.suggestedStop ?? 0).toLocaleString()}へ(
                    <Link href="/positions" className="underline">
                      ポジション管理で変更
                    </Link>
                    )
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {breakouts.length === 0 && newSetups.length === 0 && stopRaises.length === 0 && (
        <div className="text-sm text-neutral-500">本日のシグナルはありません。</div>
      )}
    </section>
  );
}
