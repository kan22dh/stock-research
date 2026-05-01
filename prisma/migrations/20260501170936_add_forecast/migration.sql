-- CreateTable
CREATE TABLE "Forecast" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "forFiscalYearEnd" TEXT NOT NULL,
    "disclosedDate" TEXT NOT NULL,
    "netSales" REAL,
    "operatingProfit" REAL,
    "ordinaryProfit" REAL,
    "netIncome" REAL,
    "eps" REAL,
    "dividendAnnual" REAL,
    "salesYoYImplied" REAL,
    "profitYoYImplied" REAL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Forecast_code_fkey" FOREIGN KEY ("code") REFERENCES "ListedStock" ("code") ON DELETE CASCADE ON UPDATE CASCADE
);
