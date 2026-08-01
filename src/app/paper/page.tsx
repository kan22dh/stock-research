import Link from "next/link";
import { prisma } from "@/lib/db";
import { BacktestChart } from "@/components/backtest-chart";
import { WithdrawalAlert } from "@/components/withdrawal-alert";

// force-dynamic, not ISR: a stale-cached page here would silently show a
// frozen equity curve as if the account were still trading. See
// system-health-badge.tsx for the 2026-07 incident this addresses.
export const dynamic = "force-dynamic";

const BENCHMARK_CODE = "13060";

// TOPIX ETF value normalized to the paper account's starting capital at the
// account's inception date — the honest "何もしなかった場合" comparison line.
async function benchmarkSeries(
  dates: string[],
  startAmount: number,
): Promise<Map<string, number>> {
  if (dates.length === 0) return new Map();
  const bars = await prisma.priceCache.findMany({
    where: { code: BENCHMARK_CODE, date: { lte: new Date(dates[dates.length - 1]) } },
    orderBy: { date: "asc" },
    select: { date: true, close: true, adjClose: true },
  });
  if (bars.length === 0) return new Map();
  const closes = bars.map((b) => ({
    d: b.date.toISOString().slice(0, 10),
    v: b.adjClose ?? b.close,
  }));
  const valueAt = (d: string): number | null => {
    let last: number | null = null;
    for (const c of closes) {
      if (c.d > d) break;
      last = c.v;
    }
    return last;
  };
  const base = valueAt(dates[0]);
  const out = new Map<string, number>();
  if (base == null || base === 0) return out;
  for (const d of dates) {
    const v = valueAt(d);
    if (v != null) out.set(d, (v / base) * startAmount);
  }
  return out;
}

// L3 paper-autopilot dashboard: the simulated account the morning cron trades
// with the exact rules a future live bot (L5, kabu STATION API) would use.
export default async function PaperPage() {
  const [positions, trades, equityRows, cashRow, reviews] = await Promise.all([
    prisma.paperPosition.findMany({
      include: { stock: { include: { momentum: true } } },
      orderBy: { entryDate: "desc" },
    }),
    prisma.paperTrade.findMany({
      include: { stock: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.paperEquity.findMany({ orderBy: { date: "asc" } }),
    prisma.appSetting.findUnique({ where: { key: "paperCash" } }),
    prisma.paperReview.findMany({ orderBy: { month: "desc" }, take: 12 }),
  ]);

  const cash = cashRow ? Number(cashRow.value) : 600_000;
  const posValue = positions.reduce(
    (s, p) => s + (p.stock.momentum?.price ?? p.entryPrice) * p.shares,
    0,
  );
  const equity = cash + posValue;
  const START = 600_000;
  const benchMap = await benchmarkSeries(
    equityRows.map((r) => r.date),
    START,
  );
  const totalReturnPct = ((equity - START) / START) * 100;

  const closedTrades = trades.filter((t) => t.side === "sell" && t.pnl != null);
  const wins = closedTrades.filter((t) => (t.pnl ?? 0) > 0);
  const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : null;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">🤖 自動運用(仮想口座)</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
          毎月初の朝、Cronが検証で唯一生き残った戦略「RS上位10銘柄+Trend Template・月次リバランス」(10年で年+18.7%)で仮想60万円を全自動売買します。
          実弾投入(kabuステーションAPI連携)の前提となる成績記録です。
        </p>
      </header>

      <WithdrawalAlert />

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="評価総額" value={`${Math.round(equity).toLocaleString()}円`} />
        <Stat
          label="通算リターン"
          value={`${totalReturnPct >= 0 ? "+" : ""}${totalReturnPct.toFixed(1)}%`}
          tone={totalReturnPct >= 0 ? "good" : "bad"}
        />
        <Stat label="現金" value={`${Math.round(cash).toLocaleString()}円`} />
        <Stat
          label="決済勝率"
          value={winRate != null ? `${winRate.toFixed(0)}% (${wins.length}/${closedTrades.length})` : "—"}
        />
      </section>

      {equityRows.length >= 2 && (
        <section className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-5">
          <h2 className="text-sm font-semibold mb-3">資産推移 vs TOPIX ETF(同額を指数に入れた場合)</h2>
          <BacktestChart
            data={equityRows.map((r) => ({
              time: r.date,
              strategy: r.equity,
              benchmark: benchMap.get(r.date) ?? START,
            }))}
            height={240}
          />
          <div className="flex items-center gap-4 mt-2 text-xs text-neutral-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-emerald-500 inline-block rounded" />
              自動運用(RS上位10+TT+増収10%)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-neutral-500 inline-block rounded" />
              TOPIX ETF(1306)に同額
            </span>
          </div>
        </section>
      )}

      {reviews.length > 0 && (
        <section className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-5 space-y-3">
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <h2 className="text-sm font-semibold">📋 月次振り返り(自動生成)</h2>
            <span className="text-xs text-neutral-500">
              毎月初のリバランス直前に前月分をシステムが自動計算(手動レビュー不要)
            </span>
          </div>
          <div className="space-y-2">
            {reviews.map((r) => {
              const isFlagged = r.note.includes("🚩");
              return (
                <div
                  key={r.month}
                  className={`rounded-lg px-4 py-3 text-sm ${
                    isFlagged
                      ? "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900"
                      : "bg-neutral-50 dark:bg-neutral-800/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <span className="font-medium">{r.month}</span>
                    <div className="flex items-center gap-3 tabular-nums text-xs">
                      <span
                        className={
                          r.returnPct >= 0
                            ? "text-emerald-600 dark:text-emerald-400 font-semibold"
                            : "text-red-600 dark:text-red-400 font-semibold"
                        }
                      >
                        {r.returnPct >= 0 ? "+" : ""}
                        {r.returnPct.toFixed(1)}%
                      </span>
                      <span className="text-neutral-400">
                        (TOPIX {r.benchReturnPct >= 0 ? "+" : ""}
                        {r.benchReturnPct.toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                  <p className="mt-1 text-neutral-600 dark:text-neutral-400 text-xs">
                    {r.note}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold mb-3">保有中 ({positions.length}/8)</h2>
        {positions.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-neutral-500">
            現在ポジションなし(ブレイクアウト待ち、または地合いフィルタで待機中)
          </div>
        ) : (
          <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 dark:bg-neutral-800/50 text-neutral-600 dark:text-neutral-400">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">銘柄</th>
                  <th className="text-right px-3 py-2 font-medium">株数</th>
                  <th className="text-right px-3 py-2 font-medium">取得単価</th>
                  <th className="text-right px-3 py-2 font-medium">現在値</th>
                  <th className="text-right px-3 py-2 font-medium">損益</th>
                  <th className="text-right px-3 py-2 font-medium">損切り</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5 dark:divide-white/5">
                {positions.map((p) => {
                  const price = p.stock.momentum?.price ?? p.entryPrice;
                  const pnlPct = ((price - p.entryPrice) / p.entryPrice) * 100;
                  return (
                    <tr key={p.id}>
                      <td className="px-3 py-2">
                        <Link href={`/stocks/${p.code}`} className="font-medium hover:underline">
                          <span className="font-mono text-neutral-500 mr-2">{p.stock.ticker}</span>
                          {p.stock.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.shares.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">¥{p.entryPrice.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">¥{price.toLocaleString()}</td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums font-semibold ${
                          pnlPct >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {pnlPct >= 0 ? "+" : ""}
                        {pnlPct.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-500">
                        {p.stopPrice > 0 ? `¥${p.stopPrice.toLocaleString()}` : "—(月次入替)"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-3">売買履歴(直近50件)</h2>
        {trades.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-neutral-500">
            まだ取引がありません。ブレイクアウトシグナルが出た朝に自動で始まります。
          </div>
        ) : (
          <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 divide-y divide-black/5 dark:divide-white/5 overflow-hidden">
            {trades.map((t) => (
              <div key={t.id} className="px-4 py-2.5 text-sm flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <span className={t.side === "buy" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                    {t.side === "buy" ? "🟢買" : "🔴売"}
                  </span>{" "}
                  <Link href={`/stocks/${t.code}`} className="font-medium hover:underline">
                    {t.stock.ticker} {t.stock.name}
                  </Link>{" "}
                  <span className="text-neutral-500 text-xs">
                    {t.shares.toLocaleString()}株 @¥{t.price.toLocaleString()} ({t.date})
                  </span>
                  <div className="text-xs text-neutral-500 mt-0.5">{t.reason}</div>
                </div>
                {t.pnl != null && (
                  <span
                    className={`font-bold tabular-nums shrink-0 ${
                      t.pnl >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {t.pnl >= 0 ? "+" : ""}
                    {Math.round(t.pnl).toLocaleString()}円
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-black/10 dark:border-white/10 bg-neutral-50 dark:bg-neutral-800/30 px-5 py-4 text-xs text-neutral-600 dark:text-neutral-400 space-y-1.5">
        <div className="font-semibold text-neutral-700 dark:text-neutral-300">この口座の意味</div>
        <div>・実弾自動売買(L5: kabuステーションAPI)へ進む判断材料です。3〜6ヶ月の記録でTOPIXと比較してから判断します。</div>
        <div>・戦略は10年検証で唯一指数に勝った「RS上位10+Trend Template・月次リバランス」(年+18.7% vs TOPIX+13.4%)。月中の損切り・VCPブレイクアウト売買は<strong>検証で有害と判明したため意図的に外しています</strong>(日次ブレイクアウト機械売買は年+4.5%と指数に大敗)。</div>
        <div>・想定される弱み(検証済み): 最大DDは指数の約2倍・10年中5年は指数に劣後。数ヶ月の劣後で止めると最悪の結果になります。</div>
        <div>・約定は月初朝の観測価格、株数はS株(単元未満株)前提の1株単位です。実際のSBI証券のS株は1日3回約定(前場始値/後場始値/後場引け・成行のみ)のため、朝の指示書から発注すると当日後場始値での約定が基本線になり、シミュレーションとのズレが生じます。</div>
        <div>・ホームのVCP/ブレイクアウトシグナルは裁量トレード(L2/L4)の練習用で、この機械口座は使いません。</div>
        <div>・月次振り返りは事実の自動記録のみです。数ヶ月の実績でルール(RS上位10・増収10%ゲート等)を自動で変えることはしません。それは10年バックテストへの過剰適合になるためです。3ヶ月連続劣後の警告は「/backtestで前提を再検証する」ための合図であり、自動での戦略変更のトリガーではありません。</div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-4">
      <div className="text-xs text-neutral-500">{label}</div>
      <div
        className={`text-xl font-bold tabular-nums mt-1 ${
          tone === "good"
            ? "text-emerald-600 dark:text-emerald-400"
            : tone === "bad"
              ? "text-red-600 dark:text-red-400"
              : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
