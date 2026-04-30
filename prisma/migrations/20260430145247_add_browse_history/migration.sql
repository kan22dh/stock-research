-- CreateTable
CREATE TABLE "BrowseHistory" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "lastViewed" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrowseHistory_code_fkey" FOREIGN KEY ("code") REFERENCES "ListedStock" ("code") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BrowseHistory_lastViewed_idx" ON "BrowseHistory"("lastViewed");
