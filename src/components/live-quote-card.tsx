import type { StooqQuote } from "@/lib/stooq";

export function LiveQuoteCard({ quote }: { quote: StooqQuote }) {
  if (!quote.available) {
    return (
      <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-5 space-y-2">
        <h3 className="text-sm font-semibold">{quote.label}</h3>
        <div className="text-xs text-neutral-500">データ取得失敗</div>
      </div>
    );
  }

  const dayChange =
    quote.open != null && quote.price != null && quote.open !== 0
      ? ((quote.price - quote.open) / quote.open) * 100
      : null;

  const formatPrice = (v: number | null): string => {
    if (v == null) return "—";
    if (quote.unit === "JPY") return `¥${v.toFixed(2)}`;
    if (quote.unit === "USD/barrel") return `$${v.toFixed(2)}`;
    if (quote.unit === "USD/oz") return `$${v.toFixed(0)}`;
    return v.toFixed(2);
  };

  return (
    <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-5 space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[10px] text-red-500 font-bold">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              LIVE
            </span>
            {quote.label}
          </h3>
          <div className="text-xs text-neutral-500 mt-0.5">{quote.description}</div>
        </div>
        <span className="text-xs text-neutral-400 font-mono uppercase">
          {quote.symbol}
        </span>
      </div>

      <div className="flex items-baseline gap-3 flex-wrap">
        <div className="text-3xl font-bold tabular-nums">{formatPrice(quote.price)}</div>
        {dayChange != null && (
          <div
            className={`text-sm tabular-nums font-semibold ${
              dayChange >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {dayChange >= 0 ? "+" : ""}
            {dayChange.toFixed(2)}%
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-neutral-500">
        <div className="flex gap-3">
          <span>始値 <span className="tabular-nums font-medium text-neutral-700 dark:text-neutral-300">{formatPrice(quote.open)}</span></span>
          <span>高 <span className="tabular-nums font-medium text-emerald-600 dark:text-emerald-400">{formatPrice(quote.high)}</span></span>
          <span>安 <span className="tabular-nums font-medium text-red-600 dark:text-red-400">{formatPrice(quote.low)}</span></span>
        </div>
        <span className="tabular-nums">
          {quote.date} {quote.time}
        </span>
      </div>
    </div>
  );
}
