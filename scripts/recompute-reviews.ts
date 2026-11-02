// Rebuild PaperReview rows from source data (PaperEquity / PaperTrade /
// PriceCache). Needed after the 2026-11 benchmark backfill: the old rows were
// computed while TOPIX was frozen at 07-24 (bench 0.0%) and labelled a
// zero-data month as "September 0.0%". Reviews are derived data, so deleting
// and recomputing loses nothing.
import { prisma } from "../src/lib/db";
import { computeMonthlyReview } from "../src/lib/paper-review";
import { jstToday } from "../src/lib/signals";

async function main() {
  const before = await prisma.paperReview.findMany({ orderBy: { month: "asc" } });
  console.log("before:", before.map((r) => `${r.month} ${r.returnPct.toFixed(1)}/${r.benchReturnPct.toFixed(1)}`).join(" | "));
  await prisma.paperReview.deleteMany({});
  await computeMonthlyReview(jstToday().slice(0, 7));
  const after = await prisma.paperReview.findMany({ orderBy: { month: "asc" } });
  for (const r of after) console.log(`${r.month} 口座 ${r.returnPct.toFixed(1)}% / TOPIX ${r.benchReturnPct.toFixed(1)}% / 記録${r.coverageDays}日 / ${r.note}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
