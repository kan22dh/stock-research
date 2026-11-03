-- CreateTable
CREATE TABLE "GuardPosition" (
    "code" TEXT NOT NULL,
    "shares" INTEGER NOT NULL,
    "costBasis" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "GuardPosition_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "GuardOrder" (
    "id" SERIAL NOT NULL,
    "createdDate" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "shares" INTEGER NOT NULL,
    "refPrice" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "fillDate" TEXT,
    "fillPrice" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GuardOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuardTrade" (
    "id" SERIAL NOT NULL,
    "date" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "shares" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "commission" DOUBLE PRECISION NOT NULL,
    "realized" DOUBLE PRECISION,
    "orderId" INTEGER NOT NULL,
    CONSTRAINT "GuardTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuardDividend" (
    "code" TEXT NOT NULL,
    "exDate" TEXT NOT NULL,
    "shares" INTEGER NOT NULL,
    "gross" DOUBLE PRECISION NOT NULL,
    "tax" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "GuardDividend_pkey" PRIMARY KEY ("code","exDate")
);

-- CreateTable
CREATE TABLE "GuardEquity" (
    "date" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "cash" DOUBLE PRECISION NOT NULL,
    "stockValue" DOUBLE PRECISION NOT NULL,
    "floor" DOUBLE PRECISION NOT NULL,
    "exposure" DOUBLE PRECISION NOT NULL,
    "locked" BOOLEAN NOT NULL,
    CONSTRAINT "GuardEquity_pkey" PRIMARY KEY ("date")
);

-- CreateIndex
CREATE INDEX "GuardOrder_status_idx" ON "GuardOrder"("status");
CREATE INDEX "GuardOrder_createdDate_idx" ON "GuardOrder"("createdDate");
CREATE UNIQUE INDEX "GuardTrade_orderId_key" ON "GuardTrade"("orderId");
CREATE INDEX "GuardTrade_date_idx" ON "GuardTrade"("date");
