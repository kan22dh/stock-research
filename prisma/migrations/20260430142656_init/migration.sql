-- CreateTable
CREATE TABLE "ListedStock" (
    "code" TEXT NOT NULL PRIMARY KEY,
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
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PriceCache" (
    "code" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "open" REAL NOT NULL,
    "high" REAL NOT NULL,
    "low" REAL NOT NULL,
    "close" REAL NOT NULL,
    "volume" REAL NOT NULL,

    PRIMARY KEY ("code", "date"),
    CONSTRAINT "PriceCache_code_fkey" FOREIGN KEY ("code") REFERENCES "ListedStock" ("code") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Watchlist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Watchlist_code_fkey" FOREIGN KEY ("code") REFERENCES "ListedStock" ("code") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "payload" TEXT,
    "syncedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ListedStock_ticker_idx" ON "ListedStock"("ticker");

-- CreateIndex
CREATE INDEX "ListedStock_name_idx" ON "ListedStock"("name");

-- CreateIndex
CREATE INDEX "PriceCache_code_date_idx" ON "PriceCache"("code", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Watchlist_code_key" ON "Watchlist"("code");
