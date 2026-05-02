import Link from "next/link";
import { fetchAllMacroSeries, latestValue } from "@/lib/fred";
import { fetchAllStooqQuotes } from "@/lib/stooq";

export const revalidate = 60;

export async function MacroSnapshot() {
  // Live (Stooq, real-time-ish) for FX/oil + Nikkei (mostly market hours data)
  // FRED kept only for things Stooq can't provide (FF rate, 10Y treasury)
  const [liveQuotes, fredSeries] = await Promise.all([
    fetchAllStooqQuotes(["usdjpy", "oil", "nikkei"]).catch(() => []),
    fetchAllMacroSeries().catch(() => []),
  ]);

  const ffRate = fredSeries.find((s) => s.id === "DFF");
  const ust10y = fredSeries.find((s) => s.id === "DGS10");

  type Card = {
    label: string;
    value: string;
    change: string | null;
    changePositive: boolean | null;
    badge: "LIVE" | "DAILY";
    sub: string;
  };

  const cards: Card[] = [];

  for (const q of liveQuotes) {
    if (!q.available) continue;
    const dayChange =
      q.open != null && q.price != null && q.open !== 0
        ? ((q.price - q.open) / q.open) * 100
        : null;
    let valueStr = "—";
    if (q.price != null) {
      if (q.unit === "JPY") valueStr = `¥${q.price.toFixed(2)}`;
      else if (q.unit === "USD/barrel") valueStr = `$${q.price.toFixed(1)}`;
      else valueStr = q.price.toLocaleString("ja-JP");
    }
    cards.push({
      label: q.label,
      value: valueStr,
      change: dayChange != null ? `${dayChange >= 0 ? "+" : ""}${dayChange.toFixed(2)}%` : null,
      changePositive: dayChange != null ? dayChange >= 0 : null,
      badge: "LIVE",
      sub: q.time ? `${q.date} ${q.time}` : (q.date ?? ""),
    });
  }

  if (ffRate) {
    const lv = latestValue(ffRate);
    cards.push({
      label: "米FF金利",
      value: lv.value != null ? `${lv.value.toFixed(2)}%` : "—",
      change: lv.changeYoY != null ? `YoY ${lv.changeYoY >= 0 ? "+" : ""}${lv.changeYoY.toFixed(1)}%` : null,
      changePositive: lv.changeYoY != null ? lv.changeYoY >= 0 : null,
      badge: "DAILY",
      sub: lv.date ?? "",
    });
  }
  if (ust10y) {
    const lv = latestValue(ust10y);
    cards.push({
      label: "米10年債利回り",
      value: lv.value != null ? `${lv.value.toFixed(2)}%` : "—",
      change: lv.changeYoY != null ? `YoY ${lv.changeYoY >= 0 ? "+" : ""}${lv.changeYoY.toFixed(1)}%` : null,
      changePositive: lv.changeYoY != null ? lv.changeYoY >= 0 : null,
      badge: "DAILY",
      sub: lv.date ?? "",
    });
  }

  if (cards.length === 0) return null;

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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {cards.slice(0, 5).map((c) => (
          <div
            key={c.label}
            className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 px-3 py-2.5"
          >
            <div className="flex items-baseline justify-between gap-1">
              <div className="text-[10px] text-neutral-500 truncate flex-1">{c.label}</div>
              {c.badge === "LIVE" && (
                <span className="text-[8px] font-bold text-red-500 inline-flex items-center gap-0.5 shrink-0">
                  <span className="inline-block w-1 h-1 rounded-full bg-red-500 animate-pulse" />
                  LIVE
                </span>
              )}
            </div>
            <div className="text-base font-bold tabular-nums mt-0.5">{c.value}</div>
            {c.change && (
              <div
                className={`text-[10px] tabular-nums mt-0.5 ${
                  c.changePositive === true
                    ? "text-emerald-600 dark:text-emerald-400"
                    : c.changePositive === false
                      ? "text-red-600 dark:text-red-400"
                      : "text-neutral-500"
                }`}
              >
                {c.change}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
