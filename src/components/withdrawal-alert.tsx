import Link from "next/link";
import { checkWithdrawalTriggers, WITHDRAWAL_THRESHOLDS } from "@/lib/withdrawal-rule";

// The most severe banner in the app. Renders ONLY when the paper account's
// live performance has gone beyond anything this exact strategy did in its
// own 10-year backtest (2017-08〜2026-07: worst 12mo excess -34.5%, worst
// 24mo excess -43.8%, worst drawdown -40.5% — see withdrawal-rule.ts). That
// means "normal bad luck the backtest already priced in" does NOT trigger
// this — only genuinely unprecedented-for-this-strategy underperformance
// does. This is a stop-and-reassess trigger, not an auto-liquidation.
export async function WithdrawalAlert() {
  const check = await checkWithdrawalTriggers();
  if (!check.triggered) return null;

  return (
    <div className="rounded-lg border-2 border-black dark:border-red-500 bg-neutral-900 dark:bg-red-950/60 px-4 py-4 text-sm text-white">
      <div className="font-bold text-base">
        🛑 撤退ルール抵触: 過去10年の最悪を超える実績です
      </div>
      <ul className="mt-2 list-disc list-inside space-y-0.5">
        {check.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <p className="mt-2 text-neutral-300">
        これは「今月たまたま悪い」という話ではなく、2017〜2026年の10年間でこの戦略が経験した最悪の落ち込みより深刻な状態です。継続の是非を検討してください。
        <Link href="/backtest" className="underline hover:text-white ml-1">
          /backtestで前提を再検証
        </Link>
        するか、
        <Link href="/paper" className="underline hover:text-white ml-1">
          /paperで詳細を確認
        </Link>
        してください。
      </p>
      <p className="mt-2 text-xs text-neutral-400">
        閾値: 最大DD {WITHDRAWAL_THRESHOLDS.maxDrawdownPct}% / 12ヶ月超過{" "}
        {WITHDRAWAL_THRESHOLDS.rolling12mExcessPct}pt / 24ヶ月超過{" "}
        {WITHDRAWAL_THRESHOLDS.rolling24mExcessPct}pt(いずれも過去最悪値+マージン)
      </p>
    </div>
  );
}
