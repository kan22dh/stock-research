import Link from "next/link";
import { prisma } from "@/lib/db";
import { fetchYahoo } from "@/lib/yahoo-finance";

// Home-page discipline guard: surface any open position at/near its stop-loss.
// Renders nothing when all positions are safely above their stops.
export async function StopLossAlerts() {
  const positions = await prisma.position.findMany({
    where: { status: "open", stopLossPrice: { not: null } },
    include: { stock: true },
  });
  if (positions.length === 0) return null;

  const rows = await Promise.all(
    positions.map(async (p) => {
      const q = await fetchYahoo(p.code, "1mo", 300).catch(() => null);
      const price = q?.regularMarketPrice ?? null;
      if (price == null || p.stopLossPrice == null) return null;
      const distancePct = ((price - p.stopLossPrice) / price) * 100;
      return { p, price, distancePct };
    }),
  );
  const alerts = rows
    .filter((r): r is NonNullable<typeof r> => r != null)
    .filter((r) => r.distancePct < 3) // breached or within 3%
    .sort((a, b) => a.distancePct - b.distancePct);

  if (alerts.length === 0) return null;

  return (
    <section className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-red-700 dark:text-red-400">
          🛑 損切りライン警告
        </h2>
        <Link href="/positions" className="text-xs text-red-600 dark:text-red-400 hover:underline">
          ポジション管理 →
        </Link>
      </div>
      <ul className="space-y-1.5">
        {alerts.map(({ p, price, distancePct }) => (
          <li key={p.id} className="text-sm text-red-800 dark:text-red-300">
            <Link href={`/stocks/${p.code}`} className="font-medium hover:underline">
              {p.stock.ticker} {p.stock.name}
            </Link>{" "}
            — 現在値 ¥{price.toLocaleString()} は損切りライン ¥
            {p.stopLossPrice!.toLocaleString()}
            {distancePct <= 0
              ? "を割り込んでいます。ルール通り決済を検討してください。"
              : `まで残り${distancePct.toFixed(1)}%です。`}
          </li>
        ))}
      </ul>
      <p className="text-xs text-red-600/80 dark:text-red-400/70">
        損失は幾何級数的に効きます(-20%の回復には+25%が必要)。ルールの例外を作らないことが検証済みチャンピオン全員の共通項です。
      </p>
    </section>
  );
}
