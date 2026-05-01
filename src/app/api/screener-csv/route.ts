import { prisma } from "@/lib/db";

const SMALL_SCALES = ["TOPIX Small 1", "TOPIX Small 2"];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const minGrowth = url.searchParams.get("growth")
    ? Number(url.searchParams.get("growth"))
    : 0;
  const minProfit = url.searchParams.get("profit")
    ? Number(url.searchParams.get("profit"))
    : -9999;

  const stocks = await prisma.listedStock.findMany({
    where: { scaleCategory: { in: SMALL_SCALES } },
    include: {
      financials: { orderBy: { fiscalYearEnd: "desc" }, take: 1 },
      forecast: true,
    },
  });

  const rows = stocks
    .map((s) => {
      const f = s.financials[0];
      return {
        ticker: s.ticker,
        name: s.name,
        sector: s.sector33Name ?? "",
        scale: s.scaleCategory ?? "",
        netSales: f?.netSales ?? null,
        netIncome: f?.netIncome ?? null,
        eps: f?.eps ?? null,
        roe:
          f?.netIncome != null && f?.equity != null && f.equity !== 0
            ? (f.netIncome / f.equity) * 100
            : null,
        salesYoY: f?.salesYoY ?? null,
        profitYoY: f?.profitYoY ?? null,
        equityRatio:
          f?.equityRatio != null ? f.equityRatio * 100 : null,
        forecastSalesYoY: s.forecast?.salesYoYImplied ?? null,
        forecastProfitYoY: s.forecast?.profitYoYImplied ?? null,
        fiscalYearEnd: f?.fiscalYearEnd ?? "",
      };
    })
    .filter((r) => r.salesYoY != null) // require financials
    .filter((r) => (r.salesYoY ?? -9999) >= minGrowth)
    .filter((r) => (r.profitYoY ?? -9999) >= minProfit)
    .sort((a, b) => (b.salesYoY ?? 0) - (a.salesYoY ?? 0));

  const header = [
    "Ticker",
    "Name",
    "Sector",
    "Scale",
    "FiscalYearEnd",
    "NetSales",
    "NetIncome",
    "EPS",
    "ROE_%",
    "SalesYoY_%",
    "ProfitYoY_%",
    "EquityRatio_%",
    "ForecastSalesYoY_%",
    "ForecastProfitYoY_%",
  ];

  const csvLines = [header.join(",")];
  for (const r of rows) {
    csvLines.push(
      [
        r.ticker,
        '"' + r.name.replace(/"/g, '""') + '"',
        '"' + r.sector.replace(/"/g, '""') + '"',
        '"' + r.scale.replace(/"/g, '""') + '"',
        r.fiscalYearEnd,
        r.netSales ?? "",
        r.netIncome ?? "",
        r.eps != null ? r.eps.toFixed(2) : "",
        r.roe != null ? r.roe.toFixed(2) : "",
        r.salesYoY != null ? r.salesYoY.toFixed(2) : "",
        r.profitYoY != null ? r.profitYoY.toFixed(2) : "",
        r.equityRatio != null ? r.equityRatio.toFixed(2) : "",
        r.forecastSalesYoY != null ? r.forecastSalesYoY.toFixed(2) : "",
        r.forecastProfitYoY != null ? r.forecastProfitYoY.toFixed(2) : "",
      ].join(","),
    );
  }

  const csv = csvLines.join("\n");
  const today = new Date().toISOString().slice(0, 10);
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="screener_${today}.csv"`,
    },
  });
}
