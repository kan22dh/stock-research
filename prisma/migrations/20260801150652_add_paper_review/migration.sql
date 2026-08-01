-- CreateTable
CREATE TABLE "PaperReview" (
    "id" SERIAL NOT NULL,
    "month" TEXT NOT NULL,
    "returnPct" DOUBLE PRECISION NOT NULL,
    "benchReturnPct" DOUBLE PRECISION NOT NULL,
    "tradesClosed" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "avgWinYen" DOUBLE PRECISION,
    "avgLossYen" DOUBLE PRECISION,
    "netPnlYen" DOUBLE PRECISION NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaperReview_month_key" ON "PaperReview"("month");
