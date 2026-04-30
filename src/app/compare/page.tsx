import Link from "next/link";
import { prisma } from "@/lib/db";
import { syncListedInfoIfStale, syncPricesIfStale, syncFinancialsIfStale } from "@/lib/sync";
import { JQuantsAuthError } from "@/lib/jquants";
import { CandleChart, type CandlePoint } from "@/components/candle-chart";
import { formatYen, formatPercent, formatNumber } from "@/lib/financial-metrics";

type SearchParams = Promise<{ codes?: string }>;

async function loadStock(code: string) {
  await syncPricesIfStale(code).catch(() => null);
  await syncFinancialsIfStale(code).catch(() => null);
  const [stock, prices, fin] = await Promise.all([
    prisma.listedStock.findUnique({ where: { code } }),
    prisma.priceCache.findMany({ where: { code }, orderBy: { date: "asc" } }),
    prisma.financialCache.findMany({
      where: { code },
      orderBy: { fiscalYearEnd: "desc" },
      take: 1,
    }),
  ]);
  return { stock, prices, latestFin: fin[0] ?? null };
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const codes = (sp.codes ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 2);

  let authError: string | null = null;
  try {
    await syncListedInfoIfStale();
  } catch (e) {
    if (e instanceof JQuantsAuthError) authError = e.message;
  }

  const stocks = await Promise.all(codes.map((c) => loadStock(c)));
  const valid = stocks.filter((s) => s.stock != null);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">銘柄比較</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
          2銘柄を並べて、株価チャート・財務指標を比較できます。
        </p>
      </header>

      {authError && (
        <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-5 py-4 text-sm text-red-700 dark:text-red-400">
          {authError}
        </div>
      )}

      <CompareForm currentCodes={codes.join(",")} />

      {valid.length === 0 && (
        <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-neutral-500">
          上の入力欄に「7203,9432」のように銘柄コードを2つカンマ区切りで入力してください
        </div>
      )}

      {valid.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          {valid.map((s) => {
            if (!s.stock) return null;
            const candleData: CandlePoint[] = s.prices.map((p) => ({
              time: p.date.toISOString().slice(0, 10),
              open: p.open,
              high: p.high,
              low: p.low,
              close: p.close,
              volume: p.volume,
            }));
            const latestPrice = s.prices.length > 0 ? s.prices[s.prices.length - 1].close : null;
            const oldestPrice = s.prices.length > 0 ? s.prices[0].close : null;
            const yearChange =
              latestPrice != null && oldestPrice != null && oldestPrice !== 0
                ? ((latestPrice - oldestPrice) / oldestPrice) * 100
                : null;
            const eps = s.latestFin?.eps ?? null;
            const bps = s.latestFin?.bookValuePerShare ?? null;
            const per = latestPrice != null && eps != null && eps !== 0 ? latestPrice / eps : null;
            const pbr = latestPrice != null && bps != null && bps !== 0 ? latestPrice / bps : null;
            const roe =
              s.latestFin?.netIncome != null && s.latestFin?.equity != null && s.latestFin.equity !== 0
                ? (s.latestFin.netIncome / s.latestFin.equity) * 100
                : null;

            return (
              <div
                key={s.stock.code}
                className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-4 space-y-3"
              >
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <Link href={`/stocks/${s.stock.code}`} className="hover:underline">
                    <h2 className="text-lg font-bold">
                      <span className="font-mono text-neutral-500 mr-2">{s.stock.ticker}</span>
                      {s.stock.name}
                    </h2>
                  </Link>
                  <span className="text-xs text-neutral-500">{s.stock.sector33Name}</span>
                </div>

                <div className="flex items-baseline gap-3 flex-wrap">
                  <div className="text-xl font-bold tabular-nums">
                    {latestPrice != null ? `${latestPrice.toLocaleString("ja-JP")}円` : "—"}
                  </div>
                  {yearChange != null && (
                    <div
                      className={`text-sm tabular-nums ${
                        yearChange >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      1年: {yearChange >= 0 ? "+" : ""}{yearChange.toFixed(2)}%
                    </div>
                  )}
                </div>

                <CandleChart data={candleData} />

                <div className="grid grid-cols-2 gap-2 text-sm pt-2">
                  <Cell label="PER" value={`${formatNumber(per)}倍`} />
                  <Cell label="PBR" value={`${formatNumber(pbr)}倍`} />
                  <Cell label="ROE" value={formatPercent(roe)} />
                  <Cell label="売上YoY" value={formatPercent(s.latestFin?.salesYoY ?? null)} />
                  <Cell
                    label="直近売上"
                    value={formatYen(s.latestFin?.netSales ?? null, { compact: true })}
                  />
                  <Cell
                    label="直近純利益"
                    value={formatYen(s.latestFin?.netIncome ?? null, { compact: true })}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-black/5 dark:border-white/5 bg-neutral-50 dark:bg-neutral-800/30 px-3 py-2">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-sm font-semibold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function CompareForm({ currentCodes }: { currentCodes: string }) {
  return (
    <form
      action="/compare"
      method="get"
      className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-4 flex items-center gap-3 flex-wrap"
    >
      <label className="text-sm font-medium">銘柄コード（カンマ区切り、5桁）:</label>
      <input
        type="text"
        name="codes"
        defaultValue={currentCodes}
        placeholder="72030,94320"
        className="flex-1 min-w-[200px] rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white"
      />
      <button
        type="submit"
        className="rounded-lg bg-neutral-900 dark:bg-white px-4 py-1.5 text-white dark:text-neutral-900 text-sm font-medium hover:opacity-90 transition"
      >
        比較
      </button>
    </form>
  );
}
