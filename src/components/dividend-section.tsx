import type { DividendSummary } from "@/lib/dividend-summary";

export function DividendSection({ summary }: { summary: DividendSummary }) {
  if (summary.count12m === 0 && summary.recent.length === 0) {
    return null; // No dividend history at all
  }

  return (
    <section className="rounded-2xl border border-emerald-200 dark:border-emerald-900/50 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/30 dark:to-neutral-900 p-5">
      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <span className="text-emerald-600 dark:text-emerald-400">💴</span>
          配当情報
        </h2>
        <span className="text-xs text-neutral-500">
          直近12ヶ月実績 / Yahoo Finance ヒストリー
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-white/70 dark:bg-neutral-900/40 border border-emerald-100 dark:border-emerald-900/30 px-3 py-2.5">
          <div className="text-xs text-neutral-500">年間配当（直近12ヶ月）</div>
          <div className="text-2xl font-bold tabular-nums mt-0.5">
            {summary.annualAmount != null
              ? `${summary.annualAmount.toFixed(1)}円`
              : "—"}
          </div>
          {summary.count12m > 0 && (
            <div className="text-xs text-neutral-500 mt-0.5">
              年{summary.count12m}回支払（{summary.count12m === 1 ? "年1回" : `${summary.count12m}分割`}）
            </div>
          )}
        </div>

        <div className="rounded-lg bg-white/70 dark:bg-neutral-900/40 border border-emerald-100 dark:border-emerald-900/30 px-3 py-2.5">
          <div className="text-xs text-neutral-500">配当利回り（実績）</div>
          <div
            className={`text-2xl font-bold tabular-nums mt-0.5 ${
              summary.trailingYield != null && summary.trailingYield >= 4
                ? "text-emerald-600 dark:text-emerald-400"
                : summary.trailingYield != null && summary.trailingYield >= 2
                  ? "text-amber-600 dark:text-amber-400"
                  : ""
            }`}
          >
            {summary.trailingYield != null
              ? `${summary.trailingYield.toFixed(2)}%`
              : "—"}
          </div>
          <div className="text-xs text-neutral-500 mt-0.5">
            年間配当 ÷ 現在値
          </div>
        </div>

        <div className="rounded-lg bg-white/70 dark:bg-neutral-900/40 border border-emerald-100 dark:border-emerald-900/30 px-3 py-2.5">
          <div className="text-xs text-neutral-500">次回権利日（予想）</div>
          <div className="text-2xl font-bold tabular-nums mt-0.5">
            {summary.nextExDateEstimate ?? "—"}
          </div>
          <div className="text-xs text-neutral-500 mt-0.5">
            前年同時期からの推定
          </div>
        </div>
      </div>

      {summary.recent.length > 0 && (
        <div className="mt-4 pt-4 border-t border-emerald-200/60 dark:border-emerald-900/30">
          <div className="text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-2">
            支払履歴
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-neutral-500">
                <tr>
                  <th className="text-left py-1.5 font-medium">権利確定日</th>
                  <th className="text-right py-1.5 font-medium">配当額（円）</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-emerald-100 dark:divide-emerald-900/30">
                {summary.recent.map((d) => (
                  <tr key={d.date}>
                    <td className="py-1.5 tabular-nums whitespace-nowrap">{d.date}</td>
                    <td className="py-1.5 text-right tabular-nums font-medium">
                      {d.amount.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-[10px] text-neutral-500">
            ※ 表示日は ex-dividend date（権利落ち日）。実際の支払日は通常数ヶ月後（日本株は3月決算なら6月頃）。
            権利を得るには ex-dividend date の前営業日（権利付最終日）までに保有が必要。
          </div>
        </div>
      )}
    </section>
  );
}
