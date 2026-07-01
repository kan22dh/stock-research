"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

export async function createPosition(formData: FormData): Promise<{ error?: string }> {
  const code = String(formData.get("code") ?? "").trim();
  const shares = Number(formData.get("shares"));
  const entryPrice = Number(formData.get("entryPrice"));
  const entryDateStr = String(formData.get("entryDate") ?? "");
  const stopLossPrice = formData.get("stopLossPrice")
    ? Number(formData.get("stopLossPrice"))
    : null;
  const targetPrice = formData.get("targetPrice")
    ? Number(formData.get("targetPrice"))
    : null;
  const thesis = String(formData.get("thesis") ?? "").trim();

  if (!code || !Number.isFinite(shares) || shares <= 0) {
    return { error: "銘柄コードと株数は必須です" };
  }
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    return { error: "取得単価が不正です" };
  }

  const stock = await prisma.listedStock.findUnique({ where: { code } });
  if (!stock) return { error: "銘柄コードが見つかりません" };

  const position = await prisma.position.create({
    data: {
      code,
      shares,
      entryPrice,
      entryDate: entryDateStr ? new Date(entryDateStr) : new Date(),
      stopLossPrice,
      targetPrice,
    },
  });

  if (thesis) {
    await prisma.journalEntry.create({
      data: { positionId: position.id, type: "buy", reason: thesis },
    });
  }

  revalidatePath("/positions");
  revalidatePath("/");
  return {};
}

export async function closePosition(formData: FormData): Promise<{ error?: string }> {
  const id = Number(formData.get("id"));
  const closePrice = Number(formData.get("closePrice"));
  const reason = String(formData.get("reason") ?? "").trim();

  if (!Number.isFinite(id)) return { error: "不正なIDです" };
  if (!Number.isFinite(closePrice) || closePrice <= 0) {
    return { error: "決済価格が不正です" };
  }
  if (!reason) {
    return { error: "売却理由の記録は必須です(規律のため)" };
  }

  await prisma.position.update({
    where: { id },
    data: { status: "closed", closePrice, closeDate: new Date() },
  });
  await prisma.journalEntry.create({
    data: { positionId: id, type: "sell", reason },
  });

  revalidatePath("/positions");
  revalidatePath("/");
  return {};
}

export async function updateStopLoss(formData: FormData): Promise<{ error?: string }> {
  const id = Number(formData.get("id"));
  const stopLossPrice = Number(formData.get("stopLossPrice"));
  if (!Number.isFinite(id)) return { error: "不正なIDです" };
  if (!Number.isFinite(stopLossPrice) || stopLossPrice <= 0) {
    return { error: "損切り価格が不正です" };
  }
  await prisma.position.update({ where: { id }, data: { stopLossPrice } });
  revalidatePath("/positions");
  return {};
}

export async function addJournalNote(formData: FormData): Promise<{ error?: string }> {
  const positionId = Number(formData.get("positionId"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!Number.isFinite(positionId) || !reason) {
    return { error: "内容が不正です" };
  }
  await prisma.journalEntry.create({
    data: { positionId, type: "note", reason },
  });
  revalidatePath("/positions");
  return {};
}

export async function updateCashBalance(formData: FormData): Promise<{ error?: string }> {
  const cashBalance = Number(formData.get("cashBalance"));
  if (!Number.isFinite(cashBalance) || cashBalance < 0) {
    return { error: "現金残高が不正です" };
  }
  await prisma.appSetting.upsert({
    where: { key: "cashBalance" },
    create: { key: "cashBalance", value: String(cashBalance) },
    update: { value: String(cashBalance) },
  });
  revalidatePath("/positions");
  revalidatePath("/");
  return {};
}
