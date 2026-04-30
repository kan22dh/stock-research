-- CreateTable
CREATE TABLE "FinancialCache" (
    "code" TEXT NOT NULL,
    "fiscalYearEnd" TEXT NOT NULL,
    "netSales" REAL,
    "operatingProfit" REAL,
    "ordinaryProfit" REAL,
    "netIncome" REAL,
    "eps" REAL,
    "totalAssets" REAL,
    "equity" REAL,
    "equityRatio" REAL,
    "bookValuePerShare" REAL,
    "dividend" REAL,
    "salesYoY" REAL,
    "profitYoY" REAL,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("code", "fiscalYearEnd"),
    CONSTRAINT "FinancialCache_code_fkey" FOREIGN KEY ("code") REFERENCES "ListedStock" ("code") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "FinancialCache_code_idx" ON "FinancialCache"("code");
