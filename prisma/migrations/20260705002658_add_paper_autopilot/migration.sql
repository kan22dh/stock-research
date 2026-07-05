-- CreateTable
CREATE TABLE "PaperPosition" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "shares" DOUBLE PRECISION NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "entryDate" TEXT NOT NULL,
    "stopPrice" DOUBLE PRECISION NOT NULL,
    "highWater" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "PaperPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperTrade" (
    "id" SERIAL NOT NULL,
    "date" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "shares" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "pnl" DOUBLE PRECISION,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperEquity" (
    "date" TEXT NOT NULL,
    "equity" DOUBLE PRECISION NOT NULL,
    "cash" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "PaperEquity_pkey" PRIMARY KEY ("date")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaperPosition_code_key" ON "PaperPosition"("code");

-- CreateIndex
CREATE INDEX "PaperTrade_date_idx" ON "PaperTrade"("date");

-- AddForeignKey
ALTER TABLE "PaperPosition" ADD CONSTRAINT "PaperPosition_code_fkey" FOREIGN KEY ("code") REFERENCES "ListedStock"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperTrade" ADD CONSTRAINT "PaperTrade_code_fkey" FOREIGN KEY ("code") REFERENCES "ListedStock"("code") ON DELETE CASCADE ON UPDATE CASCADE;
