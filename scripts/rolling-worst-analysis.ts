// Compute the historical distribution of rolling-12-month excess returns
// (strategy - benchmark) for the validated strategy (RS top-10 + Trend
// Template, §7) over the full 10y backtest. This grounds the withdrawal
// rule in "how bad has this strategy's worst realistic year actually been"
// instead of an arbitrary number.
// Run: npx tsx scripts/rolling-worst-analysis.ts
import { prisma } from "../src/lib/db";
import { loadBacktestData, runBacktest } from "../src/lib/backtest";

function pct(v: number): string {
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

async function main() {
  const { byCode, benchmark } = await loadBacktestData();
  if (!benchmark) throw new Error("no benchmark");
  const r = runBacktest(byCode, benchmark, {
    topN: 10,
    requireTrendTemplate: true,
    costPerSideBps: 20,
    stopLossPct: 0,
  });
  if (!r) throw new Error("backtest failed");

  console.log(`検証期間: ${r.points[0].time} 〜 ${r.points[r.points.length - 1].time} (${r.months}ヶ月)`);
  console.log(`累積: 戦略×${(r.points[r.points.length - 1].strategy / 100).toFixed(2)} / ベンチ×${(r.points[r.points.length - 1].benchmark / 100).toFixed(2)}`);

  // Rolling 12-month (and 6-month) excess return windows.
  const windows = [6, 12, 24];
  for (const w of windows) {
    const excessReturns: { end: string; excess: number; stratRet: number; benchRet: number }[] = [];
    for (let i = w; i < r.points.length; i++) {
      const stratRet = r.points[i].strategy / r.points[i - w].strategy - 1;
      const benchRet = r.points[i].benchmark / r.points[i - w].benchmark - 1;
      excessReturns.push({ end: r.points[i].time, excess: stratRet - benchRet, stratRet, benchRet });
    }
    excessReturns.sort((a, b) => a.excess - b.excess);
    const worst5 = excessReturns.slice(0, 5);
    const pctile10idx = Math.floor(excessReturns.length * 0.1);
    console.log(`\n=== ローリング${w}ヶ月 超過リターン(戦略-ベンチ) ===`);
    console.log(`件数: ${excessReturns.length}`);
    console.log(`最悪: ${pct(worst5[0].excess)} (期末 ${worst5[0].end}, 戦略${pct(worst5[0].stratRet)} / ベンチ${pct(worst5[0].benchRet)})`);
    console.log(`下位10%タイル: ${pct(excessReturns[pctile10idx].excess)}`);
    console.log(`ワースト5:`);
    for (const e of worst5) console.log(`  ${e.end}: 超過${pct(e.excess)} (戦略${pct(e.stratRet)}/ベンチ${pct(e.benchRet)})`);
  }

  // Absolute max drawdown already known: r.maxDrawdown
  console.log(`\n過去最大ドローダウン(月末値ベース): ${pct(r.maxDrawdown)} (ベンチ${pct(r.benchMaxDrawdown)})`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
