import Link from "next/link";
import { fetchAllMacroSeries, latestValue } from "@/lib/fred";

const HIGHLIGHT_IDS = ["DFF", "DGS10", "DEXJPUS", "DCOILWTICO"];

export async function MacroSnapshot() {
  let series;
  try {
    series = await fetchAllMacroSeries();
  } catch {
    return null;
  }

  const highlighted = series.filter((s) => HIGHLIGHT_IDS.includes(s.id));
  if (highlighted.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          マクロ環境スナップショット
        </h2>
        <Link
          href="/macro"
          className="text-xs text-neutral-500 hover:underline"
        >
          全指標を見る →
        </Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {highlighted.map((s) => {
          const lv = latestValue(s);
          const formatVal = (v: number | null): string => {
            if (v == null) return "—";
            if (s.unit === "%") return `${v.toFixed(2)}%`;
            if (s.unit === "JPY per USD") return `¥${v.toFixed(2)}`;
            if (s.unit === "$/barrel") return `$${v.toFixed(1)}`;
            return v.toFixed(2);
          };
          return (
            <div
              key={s.id}
              className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 px-3 py-2.5"
            >
              <div className="text-[10px] text-neutral-500 truncate">{s.label}</div>
              <div className="text-base font-bold tabular-nums mt-0.5">
                {formatVal(lv.value)}
              </div>
              {lv.changeYoY != null && (
                <div
                  className={`text-[10px] tabular-nums mt-0.5 ${
                    lv.changeYoY >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  YoY {lv.changeYoY >= 0 ? "+" : ""}{lv.changeYoY.toFixed(1)}%
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
