import { fetchAllMacroSeries, latestValue, type FredSeries } from "@/lib/fred";
import { LineChart } from "@/components/line-chart";

export const revalidate = 21600; // 6h cache

const COLOR_BY_ID: Record<string, string> = {
  DFF: "#dc2626",        // red - rates
  DGS10: "#ea580c",      // orange - long rates
  CPIAUCSL: "#7c3aed",   // purple - inflation
  UNRATE: "#0891b2",     // cyan - employment
  DEXJPUS: "#16a34a",    // green - fx
  DCOILWTICO: "#525252", // gray - oil
  PAYEMS: "#0284c7",     // blue - employment
};

export default async function MacroPage() {
  const series = await fetchAllMacroSeries();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">マクロ環境</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
          米国・国際マクロ指標（過去5年）。データソース: FRED（米セントルイス連銀）
        </p>
      </header>

      {series.length === 0 ? (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-400">
          マクロデータの取得に失敗しました。FRED 側の障害かネットワーク問題の可能性があります。
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {series.map((s) => (
            <MacroCard key={s.id} series={s} />
          ))}
        </div>
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
