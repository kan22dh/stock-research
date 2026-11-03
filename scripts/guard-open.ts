// One-off: open the v2 guard account as of a past session (see the asOf
// note in src/lib/guard-account.ts). Logged in CronRun like the cron.
import { prisma } from "../src/lib/db";
import { runGuardEvening } from "../src/lib/guard-account";
import { runStage, startCronRun, finishCronRun, type StageResult } from "../src/lib/cron-run";
async function main() {
  const asOf = process.argv[2];
  const id = await startCronRun("guard-evening");
  const stages: Record<string, StageResult> = {};
  const r = await runStage(stages, "guard", () => runGuardEvening({ asOf }));
  const ok = await finishCronRun(id, stages);
  console.log(JSON.stringify({ ok, r, stages }, null, 1));
  const orders = await prisma.guardOrder.findMany({ orderBy: { id: "asc" } });
  const names = new Map((await prisma.listedStock.findMany({ where: { code: { in: orders.map((o) => o.code) } }, select: { code: true, name: true } })).map((s) => [s.code, s.name]));
  for (const o of orders) console.log(`${o.createdDate} ${o.side} ${o.code} ${names.get(o.code)} ${o.shares}株 @参考¥${o.refPrice} ≈¥${Math.round(o.shares * o.refPrice).toLocaleString()}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
