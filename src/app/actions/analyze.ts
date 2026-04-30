"use server";

import { prisma } from "@/lib/db";
import { analyzeStock, isAiEnabled, type StockContext } from "@/lib/ai";
import { fetchAllMacroSeries, latestValue } from "@/lib/fred";

export type AnalyzeResult =
  | { ok: true; analysis: string }
  | { ok: false; reason: "no-key" | "no-data" | "error"; message?: string };

export async function analyzeStockAction(code: string): Promise<AnalyzeResult> {
  if (!isAiEnabled()) {
    return { ok: false, reason: "no-key" };
  }

  const stock = await prisma.listedStock.findUnique({ where: { code } });
  if (!stock) return { ok: false, reason: "no-data", message: "銘柄が見つかりません" };

  const prices = await prisma.priceCache.findMany({
    where: { code },
    orderBy: { date: "asc" },
  });
  const fin = await prisma.financialCache.findMany({
    where: { code },
    orderBy: { fiscalYearEnd: "asc" },
  });

  const latestPrice = prices.length > 0 ? prices[prices.length - 1].close : null;
  const oldestPrice = prices.length > 0 ? prices[0].close : null;
  const priceChangePct1Year =
    latestPrice != null && oldestPrice != null && oldestPrice !== 0
      ? ((latestPrice - oldestPrice) / oldestPrice) * 100
      : null;

  const latestFin = fin[fin.length - 1];
  const eps = latestFin?.eps ?? null;
  const bps = latestFin?.bookValuePerShare ?? null;
  const per = latestPrice != null && eps != null && eps !== 0 ? latestPrice / eps : null;
  const pbr = latestPrice != null && bps != null && bps !== 0 ? latestPrice / bps : null;
  const roe =
    latestFin?.netIncome != null && latestFin?.equity != null && latestFin.equity !== 0
      ? (latestFin.netIncome / latestFin.equity) * 100
      : null;

  // Macro context: try cache; if empty, fetch (this may be slow on first call)
  let macroContext: StockContext["macroContext"] = [];
  try {
    const series = await fetchAllMacroSeries();
    macroContext = series.map((s) => {
      const lv = latestValue(s);
      return {
        label: s.label,
        value: lv.value,
        yoy: lv.changeYoY,
        unit: s.unit === "Index" ? "" : ` ${s.unit}`,
      };
    });
  } catch {
    // optional - skip if FRED fails
  }

  const ctx: StockContext = {
    ticker: stock.ticker,
    name: stock.name,
    sector33Name: stock.sector33Name,
    marketName: stock.marketName,
    scaleCategory: stock.scaleCategory,
    latestPrice,
    priceChangePct1Year,
    per,
    pbr,
    roe,
    salesYoY: latestFin?.salesYoY ?? null,
    profitYoY: latestFin?.profitYoY ?? null,
    recentAnnual: fin.map((f) => ({
      fiscalYearEnd: f.fiscalYearEnd,
      netSales: f.netSales,
      netIncome: f.netIncome,
      eps: f.eps,
    })),
    macroContext,
  };

  try {
    const analysis = await analyzeStock(ctx);
    return { ok: true, analysis };
  } catch (e) {
    return {
      ok: false,
      reason: "error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
