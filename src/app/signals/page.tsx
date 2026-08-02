import Link from "next/link";
import { prisma } from "@/lib/db";
import { computeRSRatings } from "@/lib/momentum";

// シグナル成績 — the continuous-improvement loop made visible.
// Every past pivot-breakout signal is tracked against its price today, split
// by whether it passed the three verified buy criteria at signal time. The
// point is to verify with facts that "rule-pass signals outperform rule-fail
// ones" — and if that ever stops being true, the monthly review has hard data
// to work with instead of impressions. Facts only: nothing here changes the
// strategy automatically (same policy as PaperReview).
export const dynamic = "force-dynamic";

type Row = {
  id: number;
  date: string;
  code: string;
  ticker: string;
  name: string;
  signalPrice: number;
  priceNow: number | null;
  retPct: number | null;
  days: number;
  rs: number | null;
  tt: boolean | null;
  salesYoY: number | null;
  gate: boolean;
  frozen: boolean; // criteria recorded at signal time (vs re-computed today)
};

function daysBetween(dateStr: string, now: Date): number {
  const d = new Date(`${dateStr}T00:00:00+09:00`);
  return Math.max(0, Math.round((now.getTime() - d.getTime()) / 86400000));
}

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function Stat({ label, rows }: { label: string; rows: Row[] }) {
  const withRet = rows.filter((r) => r.retPct != null) as (Row & { retPct: number })[];
  const wins = withRet.filter((r) => r.retPct > 0).length;
  const avg =
    withRet.length > 0
      ? withRet.reduce((s, r) => s + r.retPct, 0) / withRet.length
      : null;
  return (
    <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 px-4 py-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-3 flex-wrap">
        <span className="text-2xl font-bold tabular-nums">
          {withRet.length > 0 ? `${((wins / withRet.length) * 100).toFixed(0)}%` : "—"}
        </span>
        <span className="text-xs text-neutral-500">
          プラス率({wins}/{withRet.length}件)
        </span>
        <span
          className={`text-sm font-medium tabular-nums ${
            avg != null && avg >= 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400"
          }`}
        >
          平均 {fmtPct(avg)}
        </span>
      </div>
    </div>
  );
}

export default async function SignalsPage() {
  const signals = await prisma.signal.findMany({
    where: { type: "pivot_breakout" },
    orderBy: [{ date: "desc" }, { id: "asc" }],
    include: { stock: { include: { momentum: true } } },
  });

  // Legacy signals predate criteria-freezing; grade them with today's data
  // (marked ※ in the table) so early history isn't a blank.
  const hasLegacy = signals.some((s) => {
    try {
      return s.payload ? !("rs" in JSON.parse(s.payload)) : true;
    } catch {
      return true;
    }
  });
  let ratings = new Map<string, number>();
  let ttByCode = new Map<string, boolean>();
  const latestFin = new Map<string, number | null>();
  if (hasLegacy) {
    const [univ, fins] = await Promise.all([
      prisma.momentum.findMany({ select: { code: true, rsRaw: true, technicalPass: true } }),
      prisma.financialCache.findMany({
        where: { code: { in: [...new Set(signals.map((s) => s.code))] } },
        orderBy: { fiscalYearEnd: "desc" },
        select: { code: true, salesYoY: true },
      }),
    ]);
    ratings = computeRSRatings(univ);
    ttByCode = new Map(univ.map((m) => [m.code, m.technicalPass]));
    for (const f of fins) if (!latestFin.has(f.code)) latestFin.set(f.code, f.salesYoY);
  }

  const now = new Date();
  const rows: Row[] = signals.map((s) => {
    let p: Record<string, unknown> = {};
    try {
      p = s.payload ? JSON.parse(s.payload) : {};
    } catch {}
    const frozen = "rs" in p;
    const rs = frozen ? ((p.rs as number | null) ?? null) : (ratings.get(s.code) ?? null);
    const tt = frozen ? ((p.tt as boolean | null) ?? null) : (ttByCode.get(s.code) ?? null);
    const salesYoY = frozen
      ? ((p.salesYoY as number | null) ?? null)
      : (latestFin.get(s.code) ?? null);
    const gate =
      rs != null && rs >= 70 && tt === true && salesYoY != null && salesYoY >= 10;
    const signalPrice = Number(p.price ?? 0);
    const priceNow = s.stock.momentum?.price ?? null;
    const retPct =
      signalPrice > 0 && priceNow != null
        ? ((priceNow - signalPrice) / signalPrice) * 100
        : null;
    return {
      id: s.id,
      date: s.date,
      code: s.code,
      ticker: s.stock.ticker,
      name: s.stock.name,
      signalPrice,
      priceNow,
      retPct,
      days: daysBetween(s.date, now),
      rs,
      tt,
      salesYoY,
      gate,
      frozen,
    };
  });

  const passRows = rows.filter((r) => r.gate);
  const failRows = rows.filter((r) => !r.gate);

  return (
    <div className="space-y-6">
      <section className="pt-2">
        <h1 className="text-3xl font-bold tracking-tight">📈 シグナル成績</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-2 max-w-3xl">
          過去のブレイクアウト・シグナル全件を「その後どうなったか」で追跡する、
          <b>継続的改善ループ</b>のページです。仕組み:
          ①毎朝の自動スキャンがシグナルを記録 → ②このページが成績を事実で検証 →
          ③月次レビュー(
          <Link href="/paper" className="underline">自動運用の振り返り</Link>
          )でルール改善を検討 → ④変更は必ず
          <Link href="/backtest" className="underline">バックテスト検証</Link>
          を通す。印象ではなくデータで改善するための土台です。
        </p>
      </section>

      <div className="grid sm:grid-cols-2 gap-3">
        <Stat label="🔴 検証済み3基準クリア(RS70+・トレンド型・増収10%+)" rows={passRows} />
        <Stat label="⚪ 基準未達(ルール上見送りだった銘柄)" rows={failRows} />
      </div>

      <div className="rounded-lg border border-sky-200 dark:border-sky-900/50 bg-sky-50 dark:bg-sky-950/30 px-4 py-3 text-xs text-sky-800 dark:text-sky-300 space-y-1">
        <p>
          <b>この数字の読み方</b>: 騰落率は「シグナル日の価格→現在価格」の単純比較です(損切り-8%や利確ルールを適用した運用成績ではありません)。シグナルの質そのものを測るための指標です。
        </p>
        <p>
          「🔴クリア組の成績 &gt; ⚪見送り組の成績」が続いていれば、基準は機能しています。逆転が続いたら月次レビューで基準を再検証します——その場の思いつきでは変えません。
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="text-sm text-neutral-500">
          まだブレイクアウト・シグナルの記録がありません。毎朝7時のスキャンで自動的に蓄積されます。
        </div>
      ) : (
        <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-500 border-b border-black/5 dark:border-white/5">
                <th className="px-3 py-2 font-medium">日付</th>
                <th className="px-3 py-2 font-medium">銘柄</th>
                <th className="px-3 py-2 font-medium text-right">シグナル時</th>
                <th className="px-3 py-2 font-medium text-right">現在</th>
                <th className="px-3 py-2 font-medium text-right">騰落率</th>
                <th className="px-3 py-2 font-medium text-right">経過日</th>
                <th className="px-3 py-2 font-medium">判定(当時)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5 dark:divide-white/5">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                  <td className="px-3 py-2 whitespace-nowrap text-neutral-500 text-xs">
                    {r.date}
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/stocks/${r.code}`} className="hover:underline">
                      <span className="font-mono text-neutral-500 mr-1.5">{r.ticker}</span>
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    ¥{Math.round(r.signalPrice).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.priceNow != null ? `¥${Math.round(r.priceNow).toLocaleString()}` : "—"}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums font-medium ${
                      r.retPct == null
                        ? "text-neutral-400"
                        : r.retPct >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {fmtPct(r.retPct)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-500">
                    {r.days}日
                  </td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {r.gate ? (
                      <span className="text-emerald-700 dark:text-emerald-400 font-medium">🔴 クリア</span>
                    ) : (
                      <span className="text-neutral-500">⚪ 見送り</span>
                    )}
                    <span className="text-neutral-400 ml-1.5">
                      RS{r.rs ?? "—"}
                      {r.tt === true ? "・TT✓" : "・TT✗"}
                      {r.salesYoY != null
                        ? `・増収${r.salesYoY >= 0 ? "+" : ""}${r.salesYoY.toFixed(0)}%`
                        : "・増収—"}
                      {!r.frozen && "※"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-neutral-500">
        ※印: 判定基準の記録開始(2026-08)より前のシグナルのため、現在のデータで参考判定したもの。以降のシグナルはシグナル発生時点の基準値を凍結保存しています。
      </p>
    </div>
  );
}
