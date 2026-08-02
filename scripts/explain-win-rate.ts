// Clarify what "月次勝率44%" actually measures: the backtest defines it as
// "months the STRATEGY beat the BENCHMARK", not "months the strategy itself
// was profitable". These are very different numbers. Compute both plus the
// month-by-month return distribution to show the actual compounding math.
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

  const monthlyStratReturns: number[] = [];
  for (let i = 1; i < r.points.length; i++) {
    monthlyStratReturns.push(r.points[i].strategy / r.points[i - 1].strategy - 1);
  }

  const positiveMonths = monthlyStratReturns.filter((x) => x > 0).length;
  const negativeMonths = monthlyStratReturns.filter((x) => x <= 0).length;
  const avgReturn = monthlyStratReturns.reduce((s, v) => s + v, 0) / monthlyStratReturns.length;
  const avgPositive =
    monthlyStratReturns.filter((x) => x > 0).reduce((s, v) => s + v, 0) / positiveMonths;
  const avgNegative =
    monthlyStratReturns.filter((x) => x <= 0).reduce((s, v) => s + v, 0) / negativeMonths;

  console.log(`検証月数: ${monthlyStratReturns.length}`);
  console.log(`\n--- 「月次勝率」の2つの定義 ---`);
  console.log(`(A) バックテストが報告する"月次勝率"(対ベンチマーク): ${(r.monthlyWinRate * 100).toFixed(0)}%`);
  console.log(`    → 「TOPIXに勝った月」の割合。戦略自体の損益とは別物`);
  console.log(`(B) 戦略自体がプラスだった月の割合(絶対勝率): ${((positiveMonths / monthlyStratReturns.length) * 100).toFixed(0)}% (${positiveMonths}/${monthlyStratReturns.length}ヶ月)`);
  console.log(`    → こちらが「普通の意味での勝率」`);

  console.log(`\n--- 月次リターンの実際の分布 ---`);
  console.log(`プラスの月の平均: ${pct(avgPositive)}`);
  console.log(`マイナスの月の平均: ${pct(avgNegative)}`);
  console.log(`全月の平均: ${pct(avgReturn)}`);
  console.log(`月次複利で年率換算: ${pct(Math.pow(1 + avgReturn, 12) - 1)}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
