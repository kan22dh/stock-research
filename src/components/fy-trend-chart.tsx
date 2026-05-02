// Visual bar chart showing FY actuals + forecast bar (highlighted differently)
// Purely SVG/HTML, no charting library needed.

export type FYTrendBar = {
  fiscalYearEnd: string;
  netSales: number | null;
  netIncome: number | null;
  isForecast: boolean;
};

export function FYTrendChart({
  bars,
  metric = "netSales",
  label,
}: {
  bars: FYTrendBar[];
  metric?: "netSales" | "netIncome";
  label: string;
}) {
  if (bars.length === 0) return null;
  const values = bars.map((b) => (metric === "netSales" ? b.netSales : b.netIncome));
  const valid = values.filter((v): v is number => v != null);
  if (valid.length === 0) return null;

  const max = Math.max(...valid.map((v) => Math.abs(v)));
  if (max === 0) return null;

  const formatVal = (v: number | null): string => {
    if (v == null) return "—";
    if (Math.abs(v) >= 1e12) return `${(v / 1e12).toFixed(2)}兆`;
    if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(0)}億`;
    if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(0)}万`;
    return v.toFixed(0);
  };

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
        {label}
      </div>
      <div className="flex items-end gap-1.5 h-32">
        {bars.map((b) => {
          const v = metric === "netSales" ? b.netSales : b.netIncome;
          const heightPct = v != null ? Math.max(2, (Math.abs(v) / max) * 100) : 2;
          const negative = v != null && v < 0;
          return (
            <div
              key={`${b.fiscalYearEnd}-${b.isForecast ? "f" : "a"}`}
              className="flex-1 flex flex-col items-center gap-1 min-w-0"
            >
              <div className="flex-1 w-full flex items-end relative">
                <div
                  className={`w-full rounded-t transition-all ${
                    b.isForecast
                      ? "bg-gradient-to-t from-sky-300 to-sky-200 dark:from-sky-700 dark:to-sky-800 border-t-2 border-sky-500 border-dashed"
                      : negative
                        ? "bg-red-300 dark:bg-red-800/60"
                        : "bg-emerald-300 dark:bg-emerald-800/60"
                  }`}
                  style={{ height: `${heightPct}%` }}
                  title={`${b.fiscalYearEnd}: ${formatVal(v)}`}
                />
                <div
                  className={`absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] font-medium whitespace-nowrap tabular-nums ${
                    b.isForecast ? "text-sky-700 dark:text-sky-400" : ""
                  }`}
                >
                  {formatVal(v)}
                </div>
              </div>
              <div
                className={`text-[10px] tabular-nums ${
                  b.isForecast
                    ? "text-sky-700 dark:text-sky-400 font-semibold"
                    : "text-neutral-500"
                }`}
              >
                {b.fiscalYearEnd.slice(0, 4)}
                {b.isForecast && "予"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
