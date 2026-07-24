// One-time restore after the DB migration (2026-07-23): the old DB's data
// was completely unreadable (quota block covered reads too), so this
// reconstructs the few facts that can't be re-derived from external sources
// — the real NTT position, goal config, and cash balance — from values
// recorded earlier in the working conversation. Everything else (listed
// stocks, financials, prices, momentum) is re-synced fresh from J-Quants/
// Yahoo by other scripts, since it's fully re-derivable.
// Run: npx tsx scripts/restore-known-state.ts
import { prisma } from "../src/lib/db";
import { syncListedInfoIfStale } from "../src/lib/sync";

async function main() {
  console.log("syncing listed stock master...");
  const listed = await syncListedInfoIfStale();
  console.log("listed stocks:", listed.count);

  const ntt = await prisma.listedStock.findUnique({ where: { code: "94320" } });
  if (!ntt) throw new Error("NTT (94320) not found in listed master — sync issue");

  const existing = await prisma.position.findFirst({ where: { code: "94320" } });
  if (!existing) {
    const shares = 2_400_000 / 152;
    const pos = await prisma.position.create({
      data: {
        code: "94320",
        shares,
        entryPrice: 152,
        entryDate: new Date("2026-01-01"),
        stopLossPrice: Math.round(152 * 0.92 * 100) / 100,
        notes: "推定株数(取得金額240万円÷取得単価152円から逆算)。2026-07-23 DB移行に伴い会話記録から復元",
      },
    });
    await prisma.journalEntry.create({
      data: {
        positionId: pos.id,
        type: "note",
        reason:
          "2026-07-23: Prisma Postgres無料枠の月間クエリ上限超過によりDB移行(Neonへ)。このポジションは会話履歴から復元。元の取得ジャーナル文言は失われた。",
      },
    });
    console.log("NTT position restored:", pos.id, "shares=", shares);
  } else {
    console.log("NTT position already exists, skipping");
  }

  const settings: [string, string][] = [
    ["goalTarget", "50000000"],
    ["goalStart", "3000000"],
    ["goalStartDate", "2026-07-01"],
    ["goalYears", "5"],
    ["cashBalance", "600000"],
    ["paperCash", "600000"],
  ];
  for (const [key, value] of settings) {
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value },
      update: {}, // don't clobber if somehow already set
    });
  }
  console.log("goal/cash settings restored");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
