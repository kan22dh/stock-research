import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { fetchYahoo } from "./yahoo-finance";
import {
  computeMomentumMetrics,
  computeVcp,
  validBarIndices,
} from "./momentum";

// Yahoo has no meaningful rate limit (unlike J-Quants), so this can run on a
// much shorter TTL and in larger batches than the financial sync.
const MOMENTUM_TTL_MS = 20 * 60 * 60 * 1000; // ~daily

type MomentumFields = {
  price: number;
  return1m: number | null;
  return3m: number | null;
  return6m: number | null;
  return9m: number | null;
  return12m: number | null;
  rsRaw: number | null;
  ma50: number | null;
  ma150: number | null;
  ma200: number | null;
  high52w: number;
  low52w: number;
  technicalScore: number;
  technicalPass: boolean;
  vcpPass: boolean;
  vcpTightness: number | null;
  vcpVolumeDryUp: boolean;
  pivot: number | null;
};

async function computeMomentumFields(code: string): Promise<MomentumFields | null> {
  const quote = await fetchYahoo(code, "2y", 3600).catch(() => null);
  if (!quote || quote.bars.length < 60) return null;

  // Drop corrupt bars, then compute momentum on dividend-adjusted closes
  // (total-return RS) and VCP on raw OHLCV (pivot must be a tradeable price).
  const clean = validBarIndices(quote.bars.map((b) => b.close)).map(
    (i) => quote.bars[i],
  );
  if (clean.length < 60) return null;
  const m = computeMomentumMetrics(
    clean.map((b) => ({ close: b.adjClose ?? b.close })),
  );
  if (!m) return null;
  const vcp = computeVcp(clean);
  // Display fields should be actual price levels, not dividend-adjusted ones.
  const lastRaw = clean[clean.length - 1].close;

  return {
    price: lastRaw,
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
    vcpPass: vcp?.vcpPass ?? false,
    vcpTightness: vcp?.tightness ?? null,
    vcpVolumeDryUp: vcp?.volumeDryUp ?? false,
    pivot: vcp?.pivot ?? null,
  };
}

export async function syncMomentumIfStale(
  code: string,
): Promise<{ refreshed: boolean }> {
  const existing = await prisma.momentum.findUnique({ where: { code } });
  if (existing && Date.now() - existing.asOf.getTime() < MOMENTUM_TTL_MS) {
    return { refreshed: false };
  }
  const fields = await computeMomentumFields(code);
  if (!fields) return { refreshed: false };
  await prisma.momentum.upsert({
    where: { code },
    create: { code, ...fields },
    update: fields,
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

// Bulk-write a batch of computed rows in one statement each (chunked) instead
// of one upsert per code. Each write here is a single DB "operation" covering
// up to `chunkSize` rows — the dominant lever for staying inside a free-tier
// operation quota when refreshing 1,000+ stocks daily.
async function bulkUpsertMomentum(
  rows: { code: string; fields: MomentumFields }[],
  chunkSize = 200,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values = chunk.map(
      (r) => Prisma.sql`(
        ${r.code}, ${r.fields.price}, ${r.fields.return1m}, ${r.fields.return3m},
        ${r.fields.return6m}, ${r.fields.return9m}, ${r.fields.return12m}, ${r.fields.rsRaw},
        ${r.fields.ma50}, ${r.fields.ma150}, ${r.fields.ma200}, ${r.fields.high52w}, ${r.fields.low52w},
        ${r.fields.technicalScore}, ${r.fields.technicalPass}, ${r.fields.vcpPass},
        ${r.fields.vcpTightness}, ${r.fields.vcpVolumeDryUp}, ${r.fields.pivot}, NOW()
      )`,
    );
    await prisma.$executeRaw`
      INSERT INTO "Momentum" (
        code, price, "return1m", "return3m", "return6m", "return9m", "return12m", "rsRaw",
        ma50, ma150, ma200, "high52w", "low52w",
        "technicalScore", "technicalPass", "vcpPass", "vcpTightness", "vcpVolumeDryUp", pivot, "asOf"
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT (code) DO UPDATE SET
        price = EXCLUDED.price, "return1m" = EXCLUDED."return1m", "return3m" = EXCLUDED."return3m",
        "return6m" = EXCLUDED."return6m", "return9m" = EXCLUDED."return9m", "return12m" = EXCLUDED."return12m",
        "rsRaw" = EXCLUDED."rsRaw", ma50 = EXCLUDED.ma50, ma150 = EXCLUDED.ma150, ma200 = EXCLUDED.ma200,
        "high52w" = EXCLUDED."high52w", "low52w" = EXCLUDED."low52w",
        "technicalScore" = EXCLUDED."technicalScore", "technicalPass" = EXCLUDED."technicalPass",
        "vcpPass" = EXCLUDED."vcpPass", "vcpTightness" = EXCLUDED."vcpTightness",
        "vcpVolumeDryUp" = EXCLUDED."vcpVolumeDryUp", pivot = EXCLUDED.pivot, "asOf" = EXCLUDED."asOf"
    `;
  }
}

// Concurrent + batched variant for the daily cron: ONE read to find what's
// stale, concurrent Yahoo fetches (external calls, not DB ops), then writes
// batched in chunks of 200 — turns ~2,400 DB round-trips (1,200 stocks ×
// read+write) into roughly a dozen.
export async function syncMomentumBatchConcurrent(
  codes: string[],
  concurrency = 8,
): Promise<{ requested: number; synced: number; failed: number }> {
  const existing = await prisma.momentum.findMany({
    where: { code: { in: codes } },
    select: { code: true, asOf: true },
  });
  const freshAsOf = new Map(existing.map((e) => [e.code, e.asOf.getTime()]));
  const staleCodes = codes.filter((c) => {
    const asOf = freshAsOf.get(c);
    return asOf == null || Date.now() - asOf >= MOMENTUM_TTL_MS;
  });

  const computed: { code: string; fields: MomentumFields }[] = [];
  let failed = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < staleCodes.length) {
      const code = staleCodes[cursor++];
      try {
        const fields = await computeMomentumFields(code);
        if (fields) computed.push({ code, fields });
      } catch {
        failed++;
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, staleCodes.length) }, worker),
  );

  if (computed.length > 0) await bulkUpsertMomentum(computed);

  return { requested: codes.length, synced: computed.length, failed };
}
