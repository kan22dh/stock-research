-- CreateTable
CREATE TABLE "Signal" (
    "id" SERIAL NOT NULL,
    "date" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "payload" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Signal_date_idx" ON "Signal"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Signal_date_type_code_key" ON "Signal"("date", "type", "code");

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_code_fkey" FOREIGN KEY ("code") REFERENCES "ListedStock"("code") ON DELETE CASCADE ON UPDATE CASCADE;
