// Does capping how many slots one sector may take improve the verified
// strategy? The live paper account currently holds 4 regional banks out of 10
// — top-RS ranking is sector-blind, so a single hot theme can quietly turn a
// 10-name book into one bet. Test caps of 2/3/4 against no cap, holding every
// other parameter at the verified settings (top 10 + Trend Template + sales
// YoY >= 10% gate). Same eligibility function and startDate for all variants
// so the comparison window is identical.
import { prisma } from "../src/lib/db";
import { loadBacktestData, runBacktest, type BacktestParams } from "../src/lib/backtest";

const SALES_GROWTH_MIN = 10;

function pct(v: number): string {
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

async function main() {
  const { byCode, benchmark } = await loadBacktestData();
  if (!benchmark) throw new Error("no benchmark");

  // Point-in-time fundamentals gate: only fiscal years already disclosed as of
  // the rebalance date are visible (approximated by fiscalYearEnd + 3 months).
  const fins = await prisma.financialCache.findMany({
    select: { code: true, fiscalYearEnd: true, salesYoY: true },
  });
  const byCodeFin = new Map<string, { visibleFrom: string; salesYoY: number | null }[]>();
  for (const f of fins) {
    const fy = new Date(`${f.fiscalYearEnd}T00:00:00Z`);
    fy.setUTCMonth(fy.getUTCMonth() + 3);
    const arr = byCodeFin.get(f.code) ?? [];
    arr.push({ visibleFrom: fy.toISOString().slice(0, 10), salesYoY: f.salesYoY });
    byCodeFin.set(f.code, arr);
  }
  for (const arr of byCodeFin.values()) arr.sort((a, b) => (a.visibleFrom < b.visibleFrom ? 1 : -1));

  const eligibility = (code: string, date: string): boolean => {
    const arr = byCodeFin.get(code);
    if (!arr) return false;
    const latest = arr.find((r) => r.visibleFrom <= date);
    return latest?.salesYoY != null && latest.salesYoY >= SALES_GROWTH_MIN;
  };

  const stocks = await prisma.listedStock.findMany({
    select: { code: true, sector33Name: true },
  });
  const sectorMap = new Map(stocks.map((s) => [s.code, s.sector33Name]));
  const sectorOf = (code: string) => sectorMap.get(code) ?? null;

  const core: BacktestParams = {
    topN: 10,
    requireTrendTemplate: true,
    costPerSideBps: 20,
    stopLossPct: 0,
  };

  const caps = [
    { label: "セクター上限なし(現行)", extra: {} },
    { label: "1セクター最大4銘柄", extra: { maxPerSector: 4, sectorOf } },
    { label: "1セクター最大3銘柄", extra: { maxPerSector: 3, sectorOf } },
    { label: "1セクター最大2銘柄", extra: { maxPerSector: 2, sectorOf } },
  ];

  const report = (label: string, params: BacktestParams) => {
    const r = runBacktest(byCode, benchmark, params);
    if (!r) return console.log(`${label}: 検証不可`);
    console.log(
      `${label.padEnd(24)} 年率 ${pct(r.cagr).padStart(7)} / 最大DD ${pct(r.maxDrawdown).padStart(7)} / 対ベンチ勝率 ${(r.monthlyWinRate * 100).toFixed(0)}% / 平均保有 ${r.avgHoldings.toFixed(1)}銘柄 / ${r.months}ヶ月 (ベンチ年率 ${pct(r.benchCagr)})`,
    );
  };

  // (A) Core strategy over the full 10 years — the statistically meaningful
  // test of sector concentration, since it needs no fundamentals coverage.
  console.log("【A】10年フル(top10 + TrendTemplate、増収ゲートなし)\n");
  for (const c of caps) report(c.label, { ...core, ...c.extra });

  // (A2) Robustness: if a cap has a real edge it should show up in BOTH
  // halves of the sample. An edge that lives in one stretch is curve-fitting.
  const halves = [
    { label: "前半 2017-2021", startDate: "2017-01-01", endDate: "2021-06-30" },
    { label: "後半 2021-2026", startDate: "2021-07-01", endDate: "2026-12-31" },
  ];
  for (const h of halves) {
    console.log(`\n【A2】頑健性チェック ${h.label}\n`);
    for (const c of caps) {
      report(c.label, { ...core, ...c.extra, startDate: h.startDate, endDate: h.endDate });
    }
  }

  // (B) With the sales gate. FinancialCache only has computable salesYoY from
  // FY2025 onward, so the gate is blind before ~2025-06 (avg holdings collapses
  // to ~1). Clamp all variants to that window and read the result as
  // directional only — 14 months is far too short to conclude anything.
  console.log("\n【B】増収10%ゲート込み(2025-06以降のみ。データ制約で短窓・参考値)\n");
  for (const c of caps) {
    report(c.label, { ...core, ...c.extra, eligibility, startDate: "2025-06-01" });
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
