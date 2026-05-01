import Link from "next/link";

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
  salesYoY: number | null;     // %
  profitYoY: number | null;    // %
  equityRatio: number | null;  // % (already in 0-100)
};

type Props = {
  rows: ComparisonRow[];
  sectorName: string | null;
};

export function PeerComparisonTable({ rows, sectorName }: Props) {
  const withDataCount = rows.filter((r) => r.hasData).length - (rows.find((r) => r.isSelf)?.hasData ? 1 : 0);
  const peerCount = rows.filter((r) => !r.isSelf).length;

  return (
    <section className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2 px-2 pb-3">
        <h2 className="text-sm font-semibold">
          業界内比較{sectorName ? `（${sectorName}）` : ""}
        </h2>
        <span className="text-xs text-neutral-500">
          同業他社 {peerCount}社（うち財務取得済 {Math.max(withDataCount, 0)}社）
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-neutral-500 border-b border-black/10 dark:border-white/10">
            <tr>
              <th className="text-left px-3 py-2 font-medium">銘柄</th>
              <th className="text-right px-3 py-2 font-medium whitespace-nowrap">株価</th>
              <th className="text-right px-3 py-2 font-medium whitespace-nowrap">PER</th>
              <th className="text-right px-3 py-2 font-medium whitespace-nowrap">PBR</th>
              <th className="text-right px-3 py-2 font-medium whitespace-nowrap">ROE</th>
              <th className="text-right px-3 py-2 font-medium whitespace-nowrap">売上YoY</th>
              <th className="text-right px-3 py-2 font-medium whitespace-nowrap">純利益YoY</th>
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
