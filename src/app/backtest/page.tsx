import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  loadBacktestData,
  runBacktest,
  BENCHMARK_CODE,
  type BacktestResult,
} from "@/lib/backtest";
import { BacktestChart } from "@/components/backtest-chart";
import { PriceSyncButton } from "@/components/price-sync-button";

export const maxDuration = 300; // 10y × 1,200 stocks: ~12s load + ~15s compute; leave headroom on serverless

type SearchParams = Promise<{
  topN?: string;
  tt?: string; // "1" = require Trend Template
  cost?: string; // bps per side
  stop?: string; // % stop-loss from month-start price (0 = off)
  run?: string;
}>;

export default async function BacktestPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const topN = Math.max(1, Math.min(20, Number(sp.topN ?? "10")));
  const requireTrendTemplate = sp.tt !== "0"; // default ON
  const costPerSideBps = Math.max(0, Math.min(100, Number(sp.cost ?? "20")));
  const stopLossPct = Math.max(0, Math.min(50, Number(sp.stop ?? "0")));
  const shouldRun = sp.run === "1";

  const [priceCodes, benchRows] = await Promise.all([
    prisma.priceCache.groupBy({ by: ["code"] }).then((g) => g.length),
    prisma.priceCache.count({ where: { code: BENCHMARK_CODE } }),
  ]);
  const hasBenchmark = benchRows > 200;
  const dataReady = priceCodes >= 30 && hasBenchmark;

  let result: BacktestResult | null = null;
  let ranButNoResult = false;
  if (shouldRun && dataReady) {
    const { byCode, benchmark } = await loadBacktestData();
    if (benchmark) {
      result = runBacktest(byCode, benchmark, {
        topN,
        requireTrendTemplate,
        costPerSideBps,
        stopLossPct,
      });
    }
    if (!result) ranButNoResult = true;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">戦略バックテスト</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
          RS Rating上位銘柄を月次で入れ替える戦略を、過去の実データ(未来情報なし)で検証します。ベンチマークはTOPIX連動ETF(1306)。
        </p>
      </header>

      <section className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-5 space-y-3">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h2 className="text-sm font-semibold">データ準備</h2>
          <span className="text-xs text-neutral-500">
            株価履歴あり {priceCodes}銘柄 / ベンチマーク(1306){" "}
            {hasBenchmark ? "✓取得済" : "✗未取得"}
          </span>
        </div>
        <PriceSyncButton />
        {!dataReady && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-400">
            バックテストには株価履歴の事前取得が必要です。上のボタンで取得してください(Yahoo Finance由来、1〜2分)。
          </div>
        )}
      </section>

      <form
        action="/backtest"
        method="get"
        className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-5"
      >
        <input type="hidden" name="run" value="1" />
        <h2 className="text-sm font-semibold mb-3">パラメータ</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="topN" className="block text-xs font-medium mb-1.5 text-neutral-600 dark:text-neutral-400">
              保有銘柄数 (RS上位N)
            </label>
            <input
              type="number"
              id="topN"
              name="topN"
              min="1"
              max="20"
              defaultValue={String(topN)}
              className="w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm tabular-nums"
            />
            <p className="text-xs text-neutral-500 mt-1">実証では10〜20の分散が優位(5だと単一銘柄の暴落が直撃)</p>
          </div>
          <div>
            <label htmlFor="cost" className="block text-xs font-medium mb-1.5 text-neutral-600 dark:text-neutral-400">
              取引コスト (片道bps)
            </label>
            <input
              type="number"
              id="cost"
              name="cost"
              min="0"
              max="100"
              defaultValue={String(costPerSideBps)}
              className="w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm tabular-nums"
            />
            <p className="text-xs text-neutral-500 mt-1">20 = 0.2%(手数料+スリッページ想定)</p>
          </div>
          <div>
            <label htmlFor="stop" className="block text-xs font-medium mb-1.5 text-neutral-600 dark:text-neutral-400">
              損切り (%)
            </label>
            <input
              type="number"
              id="stop"
              name="stop"
              min="0"
              max="50"
              defaultValue={String(stopLossPct)}
              className="w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm tabular-nums"
            />
            <p className="text-xs text-neutral-500 mt-1">0で無効。※月次機械運用では逆効果になることが実証済み(下の注意書き参照)</p>
          </div>
          <div className="flex items-end pb-1.5">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="tt"
                value="1"
                defaultChecked={requireTrendTemplate}
                className="rounded border-black/25 dark:border-white/25"
              />
              Trend Template通過を必須にする
            </label>
          </div>
        </div>
        <div className="mt-4">
          <button
            type="submit"
            disabled={!dataReady}
            className="rounded-lg bg-neutral-900 dark:bg-white px-4 py-1.5 text-white dark:text-neutral-900 text-sm font-medium hover:opacity-90 disabled:opacity-40 transition"
          >
            ▶ バックテスト実行
          </button>
        </div>
      </form>

      {ranButNoResult && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-5 py-4 text-sm text-amber-800 dark:text-amber-400">
          有効な検証期間を確保できませんでした。株価履歴の取得数を増やしてから再実行してください。
        </div>
      )}

      {result && (
        <>
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              label="戦略 年率リターン"
              value={`${result.cagr >= 0 ? "+" : ""}${(result.cagr * 100).toFixed(1)}%`}
              positive={result.cagr >= result.benchCagr}
            />
            <StatCard
              label="TOPIX ETF 年率"
              value={`${result.benchCagr >= 0 ? "+" : ""}${(result.benchCagr * 100).toFixed(1)}%`}
            />
            <StatCard
              label="最大ドローダウン"
              value={`${(result.maxDrawdown * 100).toFixed(1)}%`}
              sub={`ベンチ ${(result.benchMaxDrawdown * 100).toFixed(1)}%`}
              positive={result.maxDrawdown >= result.benchMaxDrawdown}
            />
            <StatCard
              label="月次勝率 (対ベンチ)"
              value={`${(result.monthlyWinRate * 100).toFixed(0)}%`}
              positive={result.monthlyWinRate >= 0.5}
            />
          </section>

          <section className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-5">
            <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
              <h2 className="text-sm font-semibold">
                エクイティカーブ(開始時=100)
              </h2>
              <span className="text-xs text-neutral-500">
                検証 {result.months}ヶ月 ・ ユニバース {result.universeSize}銘柄 ・
                平均保有 {result.avgHoldings.toFixed(1)}銘柄
              </span>
            </div>
            <BacktestChart data={result.points} />
            <div className="flex items-center gap-4 mt-2 text-xs text-neutral-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-emerald-500 inline-block rounded" />
                戦略 (RS上位{result.params.topN}
                {result.params.requireTrendTemplate ? "+TT" : ""})
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-neutral-500 inline-block rounded" />
                TOPIX ETF(1306) 買い持ち
              </span>
            </div>
          </section>

          <section className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 dark:bg-neutral-800/50 text-neutral-600 dark:text-neutral-400">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">年</th>
                  <th className="text-right px-4 py-2 font-medium">戦略</th>
                  <th className="text-right px-4 py-2 font-medium">TOPIX ETF</th>
                  <th className="text-right px-4 py-2 font-medium">超過</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5 dark:divide-white/5">
                {result.yearly.map((y) => (
                  <tr key={y.year}>
                    <td className="px-4 py-2 font-medium">{y.year}</td>
                    <td className={`px-4 py-2 text-right tabular-nums font-semibold ${pnlColor(y.strategy)}`}>
                      {fmtPct(y.strategy)}
                    </td>
                    <td className={`px-4 py-2 text-right tabular-nums ${pnlColor(y.benchmark)}`}>
                      {fmtPct(y.benchmark)}
                    </td>
                    <td className={`px-4 py-2 text-right tabular-nums ${pnlColor(y.strategy - y.benchmark)}`}>
                      {fmtPct(y.strategy - y.benchmark)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="rounded-xl border border-black/10 dark:border-white/10 bg-neutral-50 dark:bg-neutral-800/30 px-5 py-4 text-xs text-neutral-600 dark:text-neutral-400 space-y-1.5">
            <div className="font-semibold text-neutral-700 dark:text-neutral-300">⚠ この結果の読み方(重要)</div>
            <div>・ユニバースは「現在上場していて財務取得済みの銘柄」のため、途中で上場廃止になった銘柄が含まれず、結果は実際より良く見えます(生存者バイアス)。</div>
            <div>・過去に機能した戦略が将来も機能する保証はありません(O&apos;Shaughnessyの研究でも2009年以降にファクター劣化が確認されています)。</div>
            <div>・月末終値での約定を仮定しています。実運用では約定価格のズレが生じます。リターンは戦略・ベンチマークとも配当込み(トータルリターン)です。</div>
            <div>・最大ドローダウンは月末値ベースのため、月中の一時的な下落はさらに深い場合があります。</div>
            <div>・検証期間はYahoo Financeの取得範囲(最大約10年)です。上場から日が浅い銘柄は、12ヶ月分の履歴が揃った月から順次ユニバースに加わります。</div>
            <div>・<strong>損切りについて</strong>: 「月末に機械的に買って月中に8%で切る」運用では損切りは逆効果です(押し目で売らされ翌月高値で買い直すホイップソーが多発)。Minervini流の7-8%損切りが機能するのは、エントリーをボラティリティ収縮したピボットポイントに限定した場合であり、この検証はそれを再現していません。実際の裁量エントリーでは損切りを置くべき、という原則は変わりません。</div>
          </section>
        </>
      )}

      {!result && !ranButNoResult && dataReady && (
        <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-neutral-500">
          パラメータを設定して「バックテスト実行」を押してください
        </div>
      )}

      <div className="text-xs text-neutral-500">
        <Link href="/screener" className="hover:underline">
          ← スクリーナーに戻る
        </Link>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  positive,
}: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
}) {
  return (
    <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-4">
      <div className="text-xs text-neutral-500">{label}</div>
      <div
        className={`text-xl font-bold tabular-nums mt-1 ${
          positive === undefined
            ? ""
            : positive
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400"
        }`}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-neutral-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

function pnlColor(v: number): string {
  return v > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : v < 0
      ? "text-red-600 dark:text-red-400"
      : "";
}
