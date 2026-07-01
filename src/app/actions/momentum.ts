"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { syncMomentumBatch } from "@/lib/momentum-sync";

// Yahoo has no meaningful rate limit, so this can cover a much bigger batch
// per click than the J-Quants financial sync.
export async function bulkSyncMomentum(): Promise<{
  requested: number;
  synced: number;
  failed: number;
}> {
  const stocks = await prisma.listedStock.findMany({
    where: { financials: { some: {} } },
    select: { code: true },
    take: 150,
    orderBy: { ticker: "asc" },
  });

  const result = await syncMomentumBatch(
    stocks.map((s) => s.code),
    150,
  );

  revalidatePath("/screener");
  revalidatePath("/");
  return result;
}
