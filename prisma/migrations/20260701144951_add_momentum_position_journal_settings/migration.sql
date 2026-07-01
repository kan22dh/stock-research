-- CreateTable
CREATE TABLE "Momentum" (
    "code" TEXT NOT NULL,
    "price" DOUBLE PRECISION,
    "return1m" DOUBLE PRECISION,
    "return3m" DOUBLE PRECISION,
    "return6m" DOUBLE PRECISION,
    "return9m" DOUBLE PRECISION,
    "return12m" DOUBLE PRECISION,
    "rsRaw" DOUBLE PRECISION,
    "ma50" DOUBLE PRECISION,
    "ma150" DOUBLE PRECISION,
    "ma200" DOUBLE PRECISION,
    "high52w" DOUBLE PRECISION,
    "low52w" DOUBLE PRECISION,
    "technicalScore" INTEGER NOT NULL DEFAULT 0,
    "technicalPass" BOOLEAN NOT NULL DEFAULT false,
    "asOf" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Momentum_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "shares" DOUBLE PRECISION NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "stopLossPrice" DOUBLE PRECISION,
    "targetPrice" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'open',
    "closePrice" DOUBLE PRECISION,
    "closeDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" SERIAL NOT NULL,
    "positionId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "Position_code_idx" ON "Position"("code");

-- CreateIndex
CREATE INDEX "Position_status_idx" ON "Position"("status");

-- CreateIndex
CREATE INDEX "JournalEntry_positionId_idx" ON "JournalEntry"("positionId");

-- AddForeignKey
ALTER TABLE "Momentum" ADD CONSTRAINT "Momentum_code_fkey" FOREIGN KEY ("code") REFERENCES "ListedStock"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_code_fkey" FOREIGN KEY ("code") REFERENCES "ListedStock"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;
