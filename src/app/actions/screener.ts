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
    // Fetch small caps that don't yet have cached financials, in ticker order.
    const smalls = await prisma.listedStock.findMany({
      where: {
        scaleCategory: { in: ["TOPIX Small 1", "TOPIX Small 2"] },
        financials: { none: {} },
      },
      select: { code: true },
      take: 30, // 30 * 6s ≈ 3 min per click (within reasonable wait)
      orderBy: { ticker: "asc" },
    });
    targetCodes = smalls.map((s) => s.code);
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
