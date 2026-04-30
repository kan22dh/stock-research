import Link from "next/link";
import { prisma } from "@/lib/db";
import { syncListedInfoIfStale } from "@/lib/sync";
import { JQuantsAuthError } from "@/lib/jquants";

const SMALL_SCALES = ["TOPIX Small 1", "TOPIX Small 2"];

export default async function ScreenerPage() {
  let authError: string | null = null;
  try {
    await syncListedInfoIfStale();
  } catch (e) {
    if (e instanceof JQuantsAuthError) authError = e.message;
  }

  // Phase A5 簡易版: TOPIX区分の Small 1 / Small 2 を中小型株の代理指標として使用
  // 厳密な時価総額500億円以下フィルタは Phase A5+ で実装（時価総額APIまたは計算で取得）
  const stocks = await prisma.listedStock.findMany({
    where: {
      scaleCategory: { in: SMALL_SCALES },
      // グロース市場除外せず幅広く取得
    },
    orderBy: [{ scaleCategory: "asc" }, { ticker: "asc" }],
    take: 200,
  });

  // セクター別集計
  const bySector = new Map<string, typeof stocks>();
  for (const s of stocks) {
    const key = s.sector33Name ?? "（業種不明）";
    if (!bySector.has(key)) bySector.set(key, []);
    bySector.get(key)!.push(s);
  }
  const sectors = Array.from(bySector.entries()).sort((a, b) => b[1].length - a[1].length);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">スクリーナー</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
          中小型株（TOPIX Small 1 / Small 2）から候補銘柄を発掘
        </p>
      </header>

      {authError && (
        <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-5 py-4 text-sm text-red-700 dark:text-red-400">
          <div className="font-semibold mb-1">J-Quants 認証エラー</div>
          <div>{authError}</div>
        </div>
      )}

      <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 px-5 py-4 text-sm space-y-2">
        <div className="font-semibold">現在のフィルタ条件（簡易版）</div>
        <ul className="list-disc list-inside text-neutral-600 dark:text-neutral-400 space-y-1">
          <li>TOPIX規模区分: Small 1 / Small 2（時価総額が比較的小さい銘柄群）</li>
          <li>表示: 上位 {stocks.length}件 / セクター別グルーピング</li>
        </ul>
        <div className="text-xs text-neutral-500 mt-2">
          ※ 厳密な「時価総額500億円以下＋成長率フィルタ」は次のフェーズで個別銘柄の財務取得後に実装します
        </div>
      </div>

      {stocks.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-12 text-center text-sm text-neutral-500">
          {authError
            ? "API認証後、スクリーナー結果が表示されます"
            : "対象銘柄が見つかりません"}
        </div>
      ) : (
        <div className="space-y-6">
          {sectors.map(([sector, list]) => (
            <section key={sector}>
              <h2 className="text-sm font-semibold mb-2 text-neutral-700 dark:text-neutral-300">
                {sector}{" "}
                <span className="text-xs font-normal text-neutral-500">
                  （{list.length}社）
                </span>
              </h2>
              <ul className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 divide-y divide-black/5 dark:divide-white/5 overflow-hidden">
                {list.slice(0, 20).map((s) => (
                  <li key={s.code}>
                    <Link
                      href={`/stocks/${s.code}`}
                      className="flex items-center justify-between gap-4 px-4 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition text-sm"
                    >
                      <div className="min-w-0 flex items-center gap-3">
                        <span className="font-mono text-neutral-500 shrink-0">
                          {s.ticker}
                        </span>
                        <span className="truncate">{s.name}</span>
                      </div>
                      <span className="text-xs text-neutral-500 shrink-0">
                        {s.scaleCategory}・{s.marketName}
                      </span>
                    </Link>
                  </li>
                ))}
                {list.length > 20 && (
                  <li className="px-4 py-2 text-xs text-neutral-500">
                    （他 {list.length - 20}社）
                  </li>
                )}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
