import {
  investmentScore,
  scoreColor,
  scoreBgColor,
  type InvestmentScoreInput,
} from "@/lib/investment-score";

export function InvestmentScoreCard({ input }: { input: InvestmentScoreInput }) {
  const result = investmentScore(input);
  if (!result) return null;

  const { total, growth, quality, value, stability, acceleration } = result;

  return (
    <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-5">
      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <span>⭐</span>投資魅力スコア
        </h2>
        <span className="text-xs text-neutral-500" title="小型成長株投資向けの複合スコア (0-100)">
          0-100 / 高いほど魅力的
        </span>
      </div>
      <div className="flex items-baseline gap-3 mb-4">
        <div className={`text-5xl font-bold tabular-nums ${scoreColor(total)}`}>
          {total.toFixed(0)}
        </div>
        <div className="text-xs text-neutral-500">/ 100</div>
      </div>
      <div className="space-y-2 text-xs">
        <Bar label="成長性" value={growth} max={40} />
        <Bar label="収益性" value={quality} max={20} />
        <Bar label="割安感" value={value} max={20} />
        <Bar label="安全性" value={stability} max={10} />
        <Bar label="加速度" value={acceleration} max={10} />
      </div>
    </div>
  );
}

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  const ratio = (value / max) * 100;
  // Color the bar segment with the same scheme as the total score
  const segColor = scoreBgColor((value / max) * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 text-neutral-600 dark:text-neutral-400">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
        <div
          className={`h-full ${segColor} transition-all`}
          style={{ width: `${ratio}%` }}
        />
      </div>
      <span className="w-12 text-right tabular-nums text-neutral-500">
        {value.toFixed(1)}/{max}
      </span>
    </div>
  );
}
