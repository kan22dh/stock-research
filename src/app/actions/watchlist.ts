"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

export async function toggleWatch(code: string, note?: string): Promise<{ watched: boolean }> {
  const existing = await prisma.watchlist.findUnique({ where: { code } });
  if (existing) {
    await prisma.watchlist.delete({ where: { code } });
    revalidatePath(`/stocks/${code}`);
    revalidatePath("/");
    return { watched: false };
  }
  await prisma.watchlist.create({
    data: { code, note: note ?? null },
  });
  revalidatePath(`/stocks/${code}`);
  revalidatePath("/");
  return { watched: true };
}
