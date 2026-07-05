import Link from "next/link";
import { prisma } from "@/lib/db";
import { LineChart } from "@/components/line-chart";

export const revalidate = 300;

// L3 paper-autopilot dashboard: the simulated account the morning cron trades
// with the exact rules a future live bot (L5, kabu STATION API) would use.
export default async function PaperPage() {
  const [positions, trades, equityRows, cashRow] = await Promise.all([
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
  ]);

  const cash = cashRow ? Number(cashRow.value) : 600_000;
  const posValue = positions.reduce(
    (s, p) => s + (p.stock.momentum?.price ?? p.entryPrice) * p.shares,
    0,
  );
  const equity = cash + posValue;
  const START = 600_000;
  const totalReturnPct = ((equity - START) / START) * 100;

  const closedTrades = trades.filter((t) => t.side === "sell" && t.pnl != null);
  const wins = closedTrades.filter((t) => (t.pnl ?? 0) > 0);
  const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : null;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">🤖 自動運用(仮想口座)</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
          毎朝のCronが検証済みルール(ピボット突破買い・リスク1%・損切り8%・+10%でトレーリング・地合いフィルタ)で仮想60万円を全自動売買します。
          実弾投入(kabuステーションAPI連携)の前提となる成績記録です。
        </p>
      </header>

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
          <h2 className="text-sm font-semibold mb-3">資産推移</h2>
          <LineChart
            data={equityRows.map((r) => ({ time: r.date, value: r.equity }))}
            color="#10b981"
            height={220}
          />
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
                        ¥{p.stopPrice.toLocaleString()}
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
        <div>・約定は「シグナル翌朝の観測価格」を仮定しています。実運用ではズレ(スリッページ)が生じます。</div>
        <div>・株数はS株(単元未満株、SBIは手数料無料)前提の1株単位です。単元株のみだと60万円の資金ではリスク1%規律とほぼ両立しないため。</div>
        <div>・仮想でも規律は本番と同じ: リスク1%/トレード・損切り8%・地合い悪化時は新規買い停止。</div>
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
