-- CreateTable
CREATE TABLE "ListedStock" (
    "code" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEnglish" TEXT,
    "sector33Code" TEXT,
    "sector33Name" TEXT,
    "sector17Code" TEXT,
    "sector17Name" TEXT,
    "scaleCategory" TEXT,
    "marketCode" TEXT,
    "marketName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListedStock_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "PriceCache" (
    "code" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "open" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "close" DOUBLE PRECISION NOT NULL,
    "volume" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "PriceCache_pkey" PRIMARY KEY ("code","date")
);

-- CreateTable
CREATE TABLE "Watchlist" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrowseHistory" (
    "code" TEXT NOT NULL,
    "lastViewed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrowseHistory_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Forecast" (
    "code" TEXT NOT NULL,
    "forFiscalYearEnd" TEXT NOT NULL,
    "disclosedDate" TEXT NOT NULL,
    "netSales" DOUBLE PRECISION,
    "operatingProfit" DOUBLE PRECISION,
    "ordinaryProfit" DOUBLE PRECISION,
    "netIncome" DOUBLE PRECISION,
    "eps" DOUBLE PRECISION,
    "dividendAnnual" DOUBLE PRECISION,
    "salesYoYImplied" DOUBLE PRECISION,
    "profitYoYImplied" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Forecast_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "FinancialCache" (
    "code" TEXT NOT NULL,
    "fiscalYearEnd" TEXT NOT NULL,
    "netSales" DOUBLE PRECISION,
    "operatingProfit" DOUBLE PRECISION,
    "ordinaryProfit" DOUBLE PRECISION,
    "netIncome" DOUBLE PRECISION,
    "eps" DOUBLE PRECISION,
    "totalAssets" DOUBLE PRECISION,
    "equity" DOUBLE PRECISION,
    "equityRatio" DOUBLE PRECISION,
    "bookValuePerShare" DOUBLE PRECISION,
    "dividend" DOUBLE PRECISION,
    "salesYoY" DOUBLE PRECISION,
    "profitYoY" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialCache_pkey" PRIMARY KEY ("code","fiscalYearEnd")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "key" TEXT NOT NULL,
    "payload" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "ListedStock_ticker_idx" ON "ListedStock"("ticker");

-- CreateIndex
CREATE INDEX "ListedStock_name_idx" ON "ListedStock"("name");

-- CreateIndex
CREATE INDEX "PriceCache_code_date_idx" ON "PriceCache"("code", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Watchlist_code_key" ON "Watchlist"("code");

-- CreateIndex
CREATE INDEX "BrowseHistory_lastViewed_idx" ON "BrowseHistory"("lastViewed");

-- CreateIndex
CREATE INDEX "FinancialCache_code_idx" ON "FinancialCache"("code");

-- AddForeignKey
ALTER TABLE "PriceCache" ADD CONSTRAINT "PriceCache_code_fkey" FOREIGN KEY ("code") REFERENCES "ListedStock"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Watchlist" ADD CONSTRAINT "Watchlist_code_fkey" FOREIGN KEY ("code") REFERENCES "ListedStock"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrowseHistory" ADD CONSTRAINT "BrowseHistory_code_fkey" FOREIGN KEY ("code") REFERENCES "ListedStock"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Forecast" ADD CONSTRAINT "Forecast_code_fkey" FOREIGN KEY ("code") REFERENCES "ListedStock"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialCache" ADD CONSTRAINT "FinancialCache_code_fkey" FOREIGN KEY ("code") REFERENCES "ListedStock"("code") ON DELETE CASCADE ON UPDATE CASCADE;
