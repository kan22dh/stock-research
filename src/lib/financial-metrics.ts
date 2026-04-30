import type { StatementRow } from "./jquants";

export type FiscalYearSummary = {
  fiscalYearEnd: string;
  netSales: number | null;
  operatingProfit: number | null;
  ordinaryProfit: number | null;
  netIncome: number | null;
  eps: number | null;
  totalAssets: number | null;
  equity: number | null;
  equityRatio: number | null;
  bookValuePerShare: number | null;
  dividend: number | null;
};

function num(v: string | undefined | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// 通期 (FY) のみ抽出して年度別に並べる
export function extractAnnualSummaries(rows: StatementRow[]): FiscalYearSummary[] {
  const annual = rows.filter((r) => r.TypeOfCurrentPeriod === "FY");

  // 期末日でソート (古い→新しい)
  annual.sort((a, b) =>
    a.CurrentPeriodEndDate.localeCompare(b.CurrentPeriodEndDate),
  );

  // 同じ期末日の重複は最後の DisclosedDate を採用 (修正開示優先)
  const dedup = new Map<string, StatementRow>();
  for (const r of annual) {
    const key = r.CurrentPeriodEndDate;
    const existing = dedup.get(key);
    if (!existing || r.DisclosedDate > existing.DisclosedDate) {
      dedup.set(key, r);
    }
  }

  return Array.from(dedup.values()).map((r) => ({
    fiscalYearEnd: r.CurrentPeriodEndDate,
    netSales: num(r.NetSales),
    operatingProfit: num(r.OperatingProfit),
    ordinaryProfit: num(r.OrdinaryProfit),
    netIncome: num(r.Profit),
    eps: num(r.EarningsPerShare),
    totalAssets: num(r.TotalAssets),
    equity: num(r.Equity),
    equityRatio: num(r.EquityToAssetRatio),
    bookValuePerShare: num(r.BookValuePerShare),
    dividend: num(r.ResultDividendPerShareAnnual),
  }));
}

export type DerivedMetrics = {
  latestPrice: number | null;
  latestEps: number | null;
  latestBps: number | null;
  per: number | null;
  pbr: number | null;
  roe: number | null; // 直近通期 純利益 / 直近通期 純資産
  salesGrowthYoY: number | null;
  profitGrowthYoY: number | null;
};

export function deriveMetrics(
  summaries: FiscalYearSummary[],
  latestPrice: number | null,
): DerivedMetrics {
  const sorted = [...summaries].sort((a, b) =>
    b.fiscalYearEnd.localeCompare(a.fiscalYearEnd),
  );
  const latest = sorted[0];
  const prev = sorted[1];

  const eps = latest?.eps ?? null;
  const bps = latest?.bookValuePerShare ?? null;

  const per = latestPrice != null && eps != null && eps !== 0 ? latestPrice / eps : null;
  const pbr = latestPrice != null && bps != null && bps !== 0 ? latestPrice / bps : null;

  const roe =
    latest?.netIncome != null && latest?.equity != null && latest.equity !== 0
      ? (latest.netIncome / latest.equity) * 100
      : null;

  const salesGrowthYoY =
    latest?.netSales != null && prev?.netSales != null && prev.netSales !== 0
      ? ((latest.netSales - prev.netSales) / Math.abs(prev.netSales)) * 100
      : null;

  const profitGrowthYoY =
    latest?.netIncome != null && prev?.netIncome != null && prev.netIncome !== 0
      ? ((latest.netIncome - prev.netIncome) / Math.abs(prev.netIncome)) * 100
      : null;

  return {
    latestPrice,
    latestEps: eps,
    latestBps: bps,
    per,
    pbr,
    roe,
    salesGrowthYoY,
    profitGrowthYoY,
  };
}

export function formatYen(v: number | null, opts: { compact?: boolean } = {}): string {
  if (v == null) return "—";
  if (opts.compact) {
    if (Math.abs(v) >= 1e12) return `${(v / 1e12).toFixed(2)}兆円`;
    if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(1)}億円`;
    if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(1)}万円`;
  }
  return `${Math.round(v).toLocaleString("ja-JP")}円`;
}

export function formatPercent(v: number | null, fractionDigits = 1): string {
  if (v == null) return "—";
  return `${v.toFixed(fractionDigits)}%`;
}

export function formatNumber(v: number | null, fractionDigits = 2): string {
  if (v == null) return "—";
  return v.toFixed(fractionDigits);
}
