import { prisma } from "./db";
import { fetchYahoo } from "./yahoo-finance";
import { computeMomentumMetrics } from "./momentum";

// Yahoo has no meaningful rate limit (unlike J-Quants), so this can run on a
// much shorter TTL and in larger batches than the financial sync.
const MOMENTUM_TTL_MS = 20 * 60 * 60 * 1000; // ~daily

export async function syncMomentumIfStale(
  code: string,
): Promise<{ refreshed: boolean }> {
  const existing = await prisma.momentum.findUnique({ where: { code } });
  if (existing && Date.now() - existing.asOf.getTime() < MOMENTUM_TTL_MS) {
    return { refreshed: false };
  }

  const quote = await fetchYahoo(code, "2y", 3600).catch(() => null);
  if (!quote || quote.bars.length < 60) return { refreshed: false };

  const m = computeMomentumMetrics(quote.bars);
  if (!m) return { refreshed: false };

  await prisma.momentum.upsert({
    where: { code },
    create: {
      code,
      price: m.price,
      return1m: m.return1m,
      return3m: m.return3m,
      return6m: m.return6m,
      return9m: m.return9m,
      return12m: m.return12m,
      rsRaw: m.rsRaw,
      ma50: m.ma50,
      ma150: m.ma150,
      ma200: m.ma200,
      high52w: m.high52w,
      low52w: m.low52w,
      technicalScore: m.technicalScore,
      technicalPass: m.technicalPass,
    },
    update: {
      price: m.price,
      return1m: m.return1m,
      return3m: m.return3m,
      return6m: m.return6m,
      return9m: m.return9m,
      return12m: m.return12m,
      rsRaw: m.rsRaw,
      ma50: m.ma50,
      ma150: m.ma150,
      ma200: m.ma200,
      high52w: m.high52w,
      low52w: m.low52w,
      technicalScore: m.technicalScore,
      technicalPass: m.technicalPass,
    },
  });

  return { refreshed: true };
}

// Bulk sync — used by the /api/sync-momentum route and the overnight script.
// Yahoo isn't rate-limited like J-Quants, so we can afford a short delay and
// larger batch sizes.
export async function syncMomentumBatch(
  codes: string[],
  delayMs = 150,
): Promise<{ requested: number; synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;
  for (const code of codes) {
    try {
      const r = await syncMomentumIfStale(code);
      if (r.refreshed) synced++;
    } catch {
      failed++;
    }
    if (delayMs > 0) await new Promise((res) => setTimeout(res, delayMs));
  }
  return { requested: codes.length, synced, failed };
}
