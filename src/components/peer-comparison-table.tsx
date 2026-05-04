import Link from "next/link";
import { investmentScore } from "@/lib/investment-score";
import { SyncPeersButton } from "@/components/sync-peers-button";

export type ComparisonRow = {
  code: string;
  ticker: string;
  name: string;
  isSelf?: boolean;
  hasData: boolean; // false → all metrics shown as "—"
  latestPrice: number | null;
  per: number | null;
  pbr: number | null;
  roe: number | null;          // %
  salesYoY: number | null;     // % (actual prior year YoY)
  profitYoY: number | null;    // %
  equityRatio: number | null;  // % (already in 0-100)
  forecastSalesYoY: number | null;  // % (company guidance vs prior actual FY)
  forecastProfitYoY: number | null; // %
  dividendYield: number | null;     // %
};

type Props = {
  rows: ComparisonRow[];
  sectorName: string | null;
  peerCodes?: string[];
};

export function PeerComparisonTable({ rows, sectorName, peerCodes }: Props) {
  // Count peers with FINANCIAL data (PER/ROE/YoY etc), not just price
  const peerRows = rows.filter((r) => !r.isSelf);
  const peersWithFin = peerRows.filter((r) => r.salesYoY != null || r.roe != null).length;
  const peerCount = peerRows.length;
  const selfCode = rows.find((r) => r.isSelf)?.code;

  return (
    <section className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2 px-2 pb-3">
        <h2 className="text-sm font-semibold">
          業界内比較{sectorName ? `（${sectorName}）` : ""}
        </h2>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-neutral-500">
            同業他社 {peerCount}社（うち財務取得済 {peersWithFin}社）
          </span>
          {peerCodes && selfCode && peersWithFin < peerCount && (
            <SyncPeersButton peerCodes={peerCodes} selfCode={selfCode} />
          )}
        </div>
      </div>
      {peersWithFin === 0 && peerCodes && selfCode && (
        <div className="mx-2 mb-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          ⚠ 同業他社の PER/PBR/ROE/YoY が未取得です。<strong>右上の「📊 同業他社の財務を一括取得」ボタン</strong>を押すと約50秒で取得します（株価は Yahoo Finance から既にリアルタイム表示中）。
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-neutral-500 border-b border-black/10 dark:border-white/10">
            <tr>
              <th className="text-left px-3 py-2 font-medium">銘柄</th>
              <th className="text-right px-3 py-2 font-medium whitespace-nowrap" title="投資魅力スコア (0-100)">⭐スコア</th>
              <th className="text-right px-3 py-2 font-medium whitespace-nowrap">株価</th>
              <th className="text-right px-3 py-2 font-medium whitespace-nowrap">PER</th>
              <th className="text-right px-3 py-2 font-medium whitespace-nowrap">PBR</th>
              <th className="text-right px-3 py-2 font-medium whitespace-nowrap">ROE</th>
              <th className="text-right px-3 py-2 font-medium whitespace-nowrap">売上YoY</th>
              <th className="text-right px-3 py-2 font-medium whitespace-nowrap">純利益YoY</th>
              <th className="text-right px-3 py-2 font-medium whitespace-nowrap" title="会社予想 売上YoY">予想売上YoY</th>
              <th className="text-right px-3 py-2 font-medium whitespace-nowrap" title="会社予想 純利益YoY">予想利益YoY</th>
              <th className="text-right px-3 py-2 font-medium whitespace-nowrap" title="配当利回り">配当利回り</th>
              <th className="text-right px-3 py-2 font-medium whitespace-nowrap">自己資本比率</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5 dark:divide-white/5">
            {rows.map((r) => (
              <Row key={r.code} row={r} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Row({ row }: { row: ComparisonRow }) {
  const rowClass = row.isSelf
    ? "bg-amber-50 dark:bg-amber-950/30 font-semibold"
    : "hover:bg-neutral-50 dark:hover:bg-neutral-800/30";

  const score = investmentScore({
    salesYoY: row.salesYoY,
    roe: row.roe,
    per: row.per,
    equityRatio: row.equityRatio,
    forecastSalesYoY: row.forecastSalesYoY,
  });

  return (
    <tr className={rowClass}>
      <td className="px-3 py-2.5">
        <Link
          href={`/stocks/${row.code}`}
          className="hover:underline flex items-center gap-2 min-w-0"
        >
          {row.isSelf && (
            <span className="text-xs text-amber-700 dark:text-amber-400 shrink-0">▼本銘柄</span>
          )}
          <span className="font-mono text-neutral-500 shrink-0">{row.ticker}</span>
          <span className="truncate">{row.name}</span>
        </Link>
      </td>
      <td
        className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap font-semibold ${
          score == null
            ? ""
            : score.total >= 70
              ? "text-emerald-600 dark:text-emerald-400"
              : score.total >= 50
                ? "text-amber-600 dark:text-amber-400"
                : "text-neutral-500"
        }`}
      >
        {score != null ? score.total.toFixed(0) : "—"}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
        {row.latestPrice != null ? `${row.latestPrice.toLocaleString("ja-JP")}円` : "—"}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
        {row.per != null ? `${row.per.toFixed(1)}倍` : "—"}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
        {row.pbr != null ? `${row.pbr.toFixed(2)}倍` : "—"}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
        {row.roe != null ? `${row.roe.toFixed(1)}%` : "—"}
      </td>
      <td
        className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${growthClass(row.salesYoY)}`}
      >
        {row.salesYoY != null
          ? `${row.salesYoY > 0 ? "+" : ""}${row.salesYoY.toFixed(1)}%`
          : "—"}
      </td>
      <td
        className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${growthClass(row.profitYoY)}`}
      >
        {row.profitYoY != null
          ? `${row.profitYoY > 0 ? "+" : ""}${row.profitYoY.toFixed(1)}%`
          : "—"}
      </td>
      <td
        className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${growthClass(row.forecastSalesYoY)}`}
      >
        {row.forecastSalesYoY != null
          ? `${row.forecastSalesYoY > 0 ? "+" : ""}${row.forecastSalesYoY.toFixed(1)}%`
          : "—"}
      </td>
      <td
        className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${growthClass(row.forecastProfitYoY)}`}
      >
        {row.forecastProfitYoY != null
          ? `${row.forecastProfitYoY > 0 ? "+" : ""}${row.forecastProfitYoY.toFixed(1)}%`
          : "—"}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
        {row.dividendYield != null ? `${row.dividendYield.toFixed(2)}%` : "—"}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
        {row.equityRatio != null ? `${row.equityRatio.toFixed(1)}%` : "—"}
      </td>
    </tr>
  );
}

function growthClass(v: number | null): string {
  if (v == null) return "";
  if (v > 0) return "text-emerald-600 dark:text-emerald-400";
  if (v < 0) return "text-red-600 dark:text-red-400";
  return "";
}
