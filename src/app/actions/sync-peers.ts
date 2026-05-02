"use server";

import { revalidatePath } from "next/cache";
import { syncFinancialsIfStale, syncPricesIfStale } from "@/lib/sync";

const DELAY_MS = 6000; // J-Quants free plan: ~10 req/min safe pacing

export async function syncPeersFinancials(
  codes: string[],
  options: { selfCode?: string } = {},
): Promise<{ requested: number; synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;
  for (const code of codes) {
    try {
      // Only fetch financials (not prices) — peer prices come live from Yahoo,
      // we only need fundamentals to fill PER/PBR/ROE/YoY columns.
      await syncFinancialsIfStale(code);
      synced++;
    } catch {
      failed++;
    }
    if (DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }
  if (options.selfCode) revalidatePath(`/stocks/${options.selfCode}`);
  return { requested: codes.length, synced, failed };
}
