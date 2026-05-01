"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { syncFinancialsIfStale } from "@/lib/sync";

const BATCH_DELAY_MS = 6000; // J-Quants free plan rate-limits aggressively (~10 req/min)

// Bulk-sync financial data for the given codes (or all small caps if not provided).
// Returns counts. Designed to be called via Server Action from the screener UI.
export async function bulkSyncFinancials(
  codes?: string[],
): Promise<{ requested: number; synced: number; failed: number }> {
  let targetCodes: string[];
  if (codes && codes.length > 0) {
    targetCodes = codes;
  } else {
    // Priority order: watchlist > browse history > untouched small caps
    const watchlist = await prisma.watchlist.findMany({
      include: { stock: { include: { financials: { take: 1 } } } },
    });
    const watchlistMissing = watchlist
      .filter((w) => w.stock.financials.length === 0)
      .map((w) => w.code);

    const history = await prisma.browseHistory.findMany({
      orderBy: { lastViewed: "desc" },
      take: 20,
      include: { stock: { include: { financials: { take: 1 } } } },
    });
    const historyMissing = history
      .filter((h) => h.stock.financials.length === 0)
      .map((h) => h.code);

    const collected = new Set<string>();
    const ordered: string[] = [];
    for (const c of [...watchlistMissing, ...historyMissing]) {
      if (!collected.has(c)) {
        ordered.push(c);
        collected.add(c);
      }
    }

    const remaining = 30 - ordered.length;
    if (remaining > 0) {
      const smalls = await prisma.listedStock.findMany({
        where: {
          scaleCategory: { in: ["TOPIX Small 1", "TOPIX Small 2"] },
          financials: { none: {} },
          code: { notIn: Array.from(collected) },
        },
        select: { code: true },
        take: remaining,
        orderBy: { ticker: "asc" },
      });
      for (const s of smalls) {
        ordered.push(s.code);
      }
    }
    targetCodes = ordered.slice(0, 30);
  }

  let synced = 0;
  let failed = 0;
  for (const code of targetCodes) {
    try {
      await syncFinancialsIfStale(code);
      synced++;
    } catch {
      failed++;
    }
    if (BATCH_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  revalidatePath("/screener");
  return { requested: targetCodes.length, synced, failed };
}
