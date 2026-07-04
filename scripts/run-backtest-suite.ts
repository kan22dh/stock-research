// Run the standard backtest variant suite and print a markdown table for
// RESEARCH_WINNING_SYSTEMS.md §7. Run: npx tsx scripts/run-backtest-suite.ts
import { prisma } from "../src/lib/db";
import { loadBacktestData, runBacktest } from "../src/lib/backtest";

const VARIANTS = [
  { label: "RS上位5 + Trend Template", topN: 5, requireTrendTemplate: true, stopLossPct: 0 },
  { label: "RS上位5 + TT + 月中8%損切り", topN: 5, requireTrendTemplate: true, stopLossPct: 8 },
  { label: "RS上位10 + Trend Template", topN: 10, requireTrendTemplate: true, stopLossPct: 0 },
  { label: "RS上位20 + Trend Template", topN: 20, requireTrendTemplate: true, stopLossPct: 0 },
  { label: "RS上位10 (TTなし)", topN: 10, requireTrendTemplate: false, stopLossPct: 0 },
];

function pct(v: number): string {
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

async function main() {
  console.log("loading data...");
  const t0 = Date.now();
  const { byCode, benchmark } = await loadBacktestData();
  if (!benchmark) throw new Error("no benchmark series (13060)");
  console.log(
    `loaded ${byCode.size} stocks + benchmark (${benchmark.dates.length} bars, ` +
      `${benchmark.dates[0]}〜${benchmark.dates[benchmark.dates.length - 1]}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );

  console.log("\n| 設定 | 年率 | 最大DD | 月次勝率 | 検証月数 |");
  console.log("|---|---|---|---|---|");
  let benchPrinted = false;
  for (const v of VARIANTS) {
    const r = runBacktest(byCode, benchmark, {
      topN: v.topN,
      requireTrendTemplate: v.requireTrendTemplate,
      costPerSideBps: 20,
      stopLossPct: v.stopLossPct,
    });
    if (!r) {
      console.log(`| ${v.label} | (期間不足) | | | |`);
      continue;
    }
    if (!benchPrinted) {
      console.log(
        `| **TOPIX ETF買い持ち(ベンチマーク)** | **${pct(r.benchCagr)}** | **${pct(r.benchMaxDrawdown)}** | — | ${r.months} |`,
      );
      benchPrinted = true;
    }
    console.log(
      `| ${v.label} | ${pct(r.cagr)} | ${pct(r.maxDrawdown)} | ${(r.monthlyWinRate * 100).toFixed(0)}% | ${r.months} |`,
    );
  }

  // Yearly detail for the headline variant (top10 + TT).
  const headline = runBacktest(byCode, benchmark, {
    topN: 10,
    requireTrendTemplate: true,
    costPerSideBps: 20,
    stopLossPct: 0,
  });
  if (headline) {
    console.log("\n年次リターン (RS上位10+TT vs ベンチ):");
    console.log("| 年 | 戦略 | TOPIX ETF | 超過 |");
    console.log("|---|---|---|---|");
    for (const y of headline.yearly) {
      console.log(
        `| ${y.year} | ${pct(y.strategy)} | ${pct(y.benchmark)} | ${pct(y.strategy - y.benchmark)} |`,
      );
    }
    console.log(`\nユニバース: ${headline.universeSize}銘柄 / 平均保有 ${headline.avgHoldings.toFixed(1)}銘柄`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
