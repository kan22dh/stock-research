import { fetchAllMacroSeries, latestValue, type FredSeries } from "@/lib/fred";
import { fetchAllStooqQuotes, type StooqInstrumentId } from "@/lib/stooq";
import { LineChart } from "@/components/line-chart";
import { LiveQuoteCard } from "@/components/live-quote-card";

// Live page - frequent revalidation since Stooq quotes are real-time-ish
// force-dynamic, not ISR — see system-health-badge.tsx for why (2026-07 incident)
export const dynamic = "force-dynamic";

const COLOR_BY_ID: Record<string, string> = {
  DFF: "#dc2626",
  DGS10: "#ea580c",
  CPIAUCSL: "#7c3aed",
  UNRATE: "#0891b2",
  DEXJPUS: "#16a34a",
  DCOILWTICO: "#525252",
  PAYEMS: "#0284c7",
  VIXCLS: "#be185d",
};

const LIVE_SYMBOLS: StooqInstrumentId[] = [
  "usdjpy",
  "eurjpy",
  "oil",
  "gold",
  "nikkei",
  "topix",
  "sp500",
  "dow",
];

// FRED series we still want; FX/oil are handled by Stooq above
const FRED_KEEP = ["DFF", "DGS10", "CPIAUCSL", "UNRATE", "PAYEMS", "VIXCLS"];

export default async function MacroPage() {
  const [series, liveQuotes] = await Promise.all([
    fetchAllMacroSeries(),
    fetchAllStooqQuotes(LIVE_SYMBOLS),
  ]);

  const fredCards = series.filter((s) => FRED_KEEP.includes(s.id));
  const liveCards = liveQuotes.filter((q) => q.available);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">マクロ環境</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
          リアルタイム指標（Stooq）と長期マクロ指標（FRED）を統合表示
        </p>
      </header>

      {liveCards.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span className="inline-flex items-center gap-1 text-xs text-red-500 font-bold">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                LIVE
              </span>
              リアルタイム指標
            </h2>
            <span className="text-xs text-neutral-500">
              Stooq（〜数分遅延）
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {liveCards.map((q) => (
              <LiveQuoteCard key={q.id} quote={q} />
            ))}
          </div>
        </section>
      )}

      {fredCards.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">長期マクロ指標（過去5年）</h2>
          <p className="text-xs text-neutral-500">
            FRED（米セントルイス連銀）— 日次/月次更新
          </p>
          <div className="grid gap-5 lg:grid-cols-2">
            {fredCards.map((s) => (
              <MacroCard key={s.id} series={s} />
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-5 text-xs text-neutral-600 dark:text-neutral-400 space-y-1.5">
        <div className="font-semibold text-neutral-700 dark:text-neutral-300">
          指標の見方（個別株投資への影響）
        </div>
        <ul className="list-disc list-inside space-y-1">
          <li><strong>FF金利・10年国債利回り↑</strong>: グロース株（高PER）にネガティブ、バリュー株にニュートラル〜ポジティブ</li>
          <li><strong>CPI（インフレ）↑</strong>: 利上げ圧力 → 株式全体にネガティブだが、価格転嫁できる企業はプラス</li>
          <li><strong>失業率↓ / 雇用↑</strong>: 景気強い → 個人消費・市場心理にポジティブ</li>
          <li><strong>USD/JPY↑（円安）</strong>: 日本の輸出企業にポジティブ、輸入依存企業にネガティブ</li>
          <li><strong>WTI原油↑</strong>: エネルギー・商社にポジティブ、運輸・素材にネガティブ</li>
          <li><strong>VIX↑</strong>: 市場の不安心理が高まっている。リスクオフ警戒</li>
        </ul>
      </section>
    </div>
  );
}

function MacroCard({ series }: { series: FredSeries }) {
  const latest = latestValue(series);
  const data = series.points
    .filter((p): p is { date: string; value: number } => p.value !== null)
    .map((p) => ({ time: p.date, value: p.value }));

  const formatVal = (v: number | null): string => {
    if (v == null) return "—";
    if (series.unit === "%") return `${v.toFixed(2)}%`;
    if (series.unit === "JPY per USD") return `¥${v.toFixed(2)}`;
    if (series.unit === "$/barrel") return `$${v.toFixed(2)}`;
    if (series.unit === "千人") return `${(v / 1000).toFixed(1)}百万人`;
    return v.toFixed(2);
  };

  return (
    <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-5 space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold">{series.label}</h3>
          <div className="text-xs text-neutral-500 mt-0.5">{series.description}</div>
        </div>
        <span className="text-xs text-neutral-400 font-mono">{series.id}</span>
      </div>

      <div className="flex items-baseline gap-3 flex-wrap">
        <div className="text-2xl font-bold tabular-nums">{formatVal(latest.value)}</div>
        {latest.changeYoY != null && (
          <div
            className={`text-xs tabular-nums ${
              latest.changeYoY >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            YoY {latest.changeYoY >= 0 ? "+" : ""}
            {latest.changeYoY.toFixed(2)}%
          </div>
        )}
        <div className="text-xs text-neutral-400 ml-auto">{latest.date ?? ""}</div>
      </div>

      <LineChart data={data} color={COLOR_BY_ID[series.id] ?? "#3b82f6"} height={160} />
    </div>
  );
}
