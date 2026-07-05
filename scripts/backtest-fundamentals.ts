// Does adding fundamental gates improve the validated monthly strategy
// (RS top-10 + Trend Template)? Point-in-time discipline: at each rebalance,
// only the latest fiscal year whose end is ≥90 days old counts as "known"
// (approximating the disclosure lag).
//
// HARD LIMITATION (stated up front): the free J-Quants plan only yields
// ~2-3 fiscal years per stock, so fundamentals-gated variants can only be
// tested over roughly the last 2 years — a short, mostly-bull window. Treat
// direction, not magnitude. Run: npx tsx scripts/backtest-fundamentals.ts

import { prisma } from "../src/lib/db";
import { loadBacktestData, runBacktest, type BacktestParams } from "../src/lib/backtest";

const START_DATE = "2024-07-01"; // when most stocks have a "known" FY row
const DISCLOSURE_LAG_DAYS = 90;

type FinRow = { fye: string; availableFrom: string; salesYoY: number | null; netIncome: number | null };

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function pct(v: number): string {
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

async function main() {
  console.log("loading fundamentals...");
  const finRows = await prisma.financialCache.findMany({
    select: { code: true, fiscalYearEnd: true, salesYoY: true, netIncome: true },
    orderBy: [{ code: "asc" }, { fiscalYearEnd: "asc" }],
  });
  const finByCode = new Map<string, FinRow[]>();
  for (const r of finRows) {
    let list = finByCode.get(r.code);
    if (!list) {
      list = [];
      finByCode.set(r.code, list);
    }
    list.push({
      fye: r.fiscalYearEnd,
      availableFrom: addDays(r.fiscalYearEnd, DISCLOSURE_LAG_DAYS),
      salesYoY: r.salesYoY,
      netIncome: r.netIncome,
    });
  }
  console.log(`fundamentals for ${finByCode.size} codes`);

  // Latest FY already "known" at the given date, or null.
  const latestKnown = (code: string, date: string): FinRow | null => {
    const list = finByCode.get(code);
    if (!list) return null;
    let best: FinRow | null = null;
    for (const r of list) if (r.availableFrom <= date) best = r;
    return best;
  };

  console.log("loading price data...");
  const { byCode, benchmark } = await loadBacktestData();
  if (!benchmark) throw new Error("no benchmark");

  const base: BacktestParams = {
    topN: 10,
    requireTrendTemplate: true,
    costPerSideBps: 20,
    stopLossPct: 0,
    startDate: START_DATE,
  };

  const variants: { label: string; eligibility?: BacktestParams["eligibility"] }[] = [
    { label: "ベースライン(モメンタムのみ)" },
    {
      label: "+黒字のみ(純利益>0)",
      eligibility: (code, date) => {
        const f = latestKnown(code, date);
        return f != null && f.netIncome != null && f.netIncome > 0;
      },
    },
    {
      label: "+増収のみ(売上YoY>0)",
      eligibility: (code, date) => {
        const f = latestKnown(code, date);
        return f != null && f.salesYoY != null && f.salesYoY > 0;
      },
    },
    {
      label: "+増収10%以上(CAN SLIM風)",
      eligibility: (code, date) => {
        const f = latestKnown(code, date);
        return f != null && f.salesYoY != null && f.salesYoY >= 10;
      },
    },
    {
      label: "+黒字かつ増収",
      eligibility: (code, date) => {
        const f = latestKnown(code, date);
        return (
          f != null &&
          f.netIncome != null &&
          f.netIncome > 0 &&
          f.salesYoY != null &&
          f.salesYoY > 0
        );
      },
    },
  ];

  // Coverage sanity: how many codes have a "known" FY at the window start?
  let covered = 0;
  for (const code of byCode.keys()) if (latestKnown(code, START_DATE)) covered++;
  console.log(`coverage at ${START_DATE}: ${covered}/${byCode.size} codes have a known FY\n`);

  console.log(`| 変種 (${START_DATE}〜, 同一期間) | 年率 | 最大DD | 月次勝率 | 検証月数 |`);
  console.log("|---|---|---|---|---|");
  let benchPrinted = false;
  for (const v of variants) {
    const r = runBacktest(byCode, benchmark, { ...base, eligibility: v.eligibility });
    if (!r) {
      console.log(`| ${v.label} | (期間不足) | | | |`);
      continue;
    }
    if (!benchPrinted) {
      console.log(
        `| **TOPIX ETF買い持ち** | **${pct(r.benchCagr)}** | **${pct(r.benchMaxDrawdown)}** | — | ${r.months} |`,
      );
      benchPrinted = true;
    }
    console.log(
      `| ${v.label} | ${pct(r.cagr)} | ${pct(r.maxDrawdown)} | ${(r.monthlyWinRate * 100).toFixed(0)}% | ${r.months} |`,
    );
  }

  // Robustness: sweep the sales-growth threshold. If the improvement only
  // exists at exactly 10%, it's curve-fitting; a broad plateau is trustworthy.
  console.log("\n閾値スイープ(増収X%以上):");
  console.log("| 閾値 | 年率 | 最大DD | 月次勝率 |");
  console.log("|---|---|---|---|");
  for (const th of [0, 5, 10, 15, 20, 30]) {
    const r = runBacktest(byCode, benchmark, {
      ...base,
      eligibility: (code, date) => {
        const f = latestKnown(code, date);
        return f != null && f.salesYoY != null && f.salesYoY >= th;
      },
    });
    if (!r) continue;
    console.log(
      `| ≥${th}% | ${pct(r.cagr)} | ${pct(r.maxDrawdown)} | ${(r.monthlyWinRate * 100).toFixed(0)}% |`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
