// v2「年間損失上限型」live paper account — the evening job (17:00 JST cron,
// after the 15:30 close). Same rules as the research simulator
// (scripts/research/sim-guard.ts), via the shared src/lib/guard-core.ts:
//   1. process every session since the last run, in order: dividends on the
//      shares held at the previous close, then fills of pending orders at
//      that session's OPEN (S株 前場始値; sells first, buys limited by cash)
//   2. mark to market at today's close; year rollover settles the previous
//      year's 特定口座 capital-gains tax first
//   3. guard: exposure = m × (V − floor) / V (TIPP floor ratchets)
//   4. month's first session → refresh the 18a target list
//   5. if the list changed or exposure drifted past the band → write tonight's
//      orders (the owner enters them 14:00–24:00 → fill at tomorrow's open)
// Idempotent: one equity row per date, one fill per order, one dividend
// credit per (code, ex-date), tax settled once per year. A Japanese market
// holiday is a successful no-op (no 1306 bar for today).

import { prisma } from "./db";
import { jstToday } from "./signals";
import {
  DEFAULT_GUARD, newYear, updateGuard, needsResize, pickTargets, planOrders, TAX_RATE,
  type GuardYearState,
} from "./guard-core";
import { fetchGuardBars, guardFeatures, mapPool, type GuardBars } from "./guard-data";

export const GUARD_START_CASH = 600_000;
export const GUARD_COMMISSION = 0; // SBI ゼロ革命 (インターネットコース + 電子交付)
const ORDER_EXPIRY_SESSIONS = 5;
const PARAMS = DEFAULT_GUARD; // pre-registered: L 5%, m 4, TIPP, band 0.10

async function getS(key: string): Promise<string | null> {
  return (await prisma.appSetting.findUnique({ where: { key } }))?.value ?? null;
}
async function setS(key: string, value: string | number | boolean): Promise<void> {
  const v = String(value);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

export type GuardRunResult = {
  date: string;
  session: boolean;
  note: string;
  value?: number;
  exposure?: number;
  floor?: number;
  fills?: number;
  dividends?: number;
  newOrders?: number;
  refreshedTargets?: boolean;
};

// opts.asOf: process as of an earlier session date — only accepted when it
// is 1306's latest bar (i.e. no later session exists yet), so it can never
// look ahead. Used once to open the account on 2026-11-02, the first
// session of November.
export async function runGuardEvening(opts: { force?: boolean; asOf?: string } = {}): Promise<GuardRunResult> {
  const today = opts.asOf ?? jstToday();

  // Trading-day check from 1306's own calendar.
  const bench = await fetchGuardBars("13060", "3mo");
  if (!bench) throw new Error("benchmark 1306: Yahoo returned no data");
  if (bench.t[bench.t.length - 1] !== today) {
    return { date: today, session: false, note: `立会なし(休日/未公表)。1306最新足 ${bench.t[bench.t.length - 1]}` };
  }
  if (!opts.force && (await prisma.guardEquity.findUnique({ where: { date: today } }))) {
    return { date: today, session: true, note: "本日分は処理済み" };
  }

  // ---- state ----
  let cash = Number((await getS("guardCash")) ?? GUARD_START_CASH);
  const lastDate = await getS("guardLastDate");
  let realizedYtd = Number((await getS("guardRealizedYtd")) ?? 0);
  const yearRaw = await getS("guardYear");
  let gs: GuardYearState = yearRaw
    ? {
        year: Number(yearRaw),
        startValue: Number(await getS("guardYearStart")),
        floor: Number(await getS("guardFloor")),
        hwm: Number(await getS("guardHwm")),
        locked: (await getS("guardLocked")) === "true",
      }
    : newYear(Number(today.slice(0, 4)), cash, PARAMS);

  const positions = await prisma.guardPosition.findMany();
  const holdings = new Map(positions.map((p) => [p.code, p.shares]));
  const basis = new Map(positions.map((p) => [p.code, p.costBasis]));
  const pending = await prisma.guardOrder.findMany({ where: { status: "pending" }, orderBy: { id: "asc" } });

  const codes = [...new Set([...holdings.keys(), ...pending.map((o) => o.code)])];
  const bars = new Map<string, GuardBars>();
  for (const [code, b] of (await mapPool(codes, 6, async (c) => [c, await fetchGuardBars(c, "3mo")] as const))) {
    if (b) bars.set(code, b);
  }

  // Sessions to process: after the last processed one, up to today.
  const sessions = lastDate ? bench.t.filter((d) => d > lastDate && d <= today) : [today];
  let fills = 0, divCount = 0;
  let lastValue = Number((await getS("guardLastValue")) ?? cash);

  for (const d of sessions) {
    // Year rollover: settle last year's capital-gains tax once, then reset.
    if (Number(d.slice(0, 4)) !== gs.year) {
      const settled = await getS(`guardTaxSettled:${gs.year}`);
      if (!settled) {
        const cgt = Math.max(0, realizedYtd) * TAX_RATE;
        cash -= cgt;
        lastValue -= cgt;
        await setS(`guardTaxSettled:${gs.year}`, Math.round(cgt));
      }
      realizedYtd = 0;
      gs = newYear(Number(d.slice(0, 4)), lastValue, PARAMS);
    }

    // Dividends on shares held at the previous close.
    for (const [code, sh] of holdings) {
      const b = bars.get(code);
      if (!b || sh <= 0) continue;
      for (const [exd, amt] of b.divs) {
        if (exd !== d) continue;
        const done = await prisma.guardDividend.findUnique({ where: { code_exDate: { code, exDate: exd } } });
        if (done) continue;
        const gross = sh * amt;
        cash += gross * (1 - TAX_RATE);
        await prisma.guardDividend.create({ data: { code, exDate: exd, shares: sh, gross, tax: gross * TAX_RATE } });
        divCount++;
      }
    }

    // Fills at this session's open: sells first, then buys (cash-limited).
    const due = pending.filter((o) => o.status === "pending" && o.createdDate < d);
    for (const o of [...due.filter((x) => x.side === "sell"), ...due.filter((x) => x.side === "buy")]) {
      const b = bars.get(o.code);
      const i = b ? b.t.indexOf(d) : -1;
      const sessionsWaited = bench.t.filter((x) => x > o.createdDate && x <= d).length;
      if (!b || i < 0 || !(b.o[i] > 0)) {
        if (sessionsWaited >= ORDER_EXPIRY_SESSIONS) {
          o.status = "expired";
          await prisma.guardOrder.update({ where: { id: o.id }, data: { status: "expired" } });
        }
        continue;
      }
      const px = b.o[i];
      let shares = 0, realized: number | null = null, commission = 0;
      if (o.side === "sell") {
        const have = holdings.get(o.code) ?? 0;
        shares = Math.min(have, o.shares);
        if (shares > 0) {
          commission = shares * px * GUARD_COMMISSION;
          const proceeds = shares * px - commission;
          const cb = ((basis.get(o.code) ?? 0) * shares) / have;
          realized = proceeds - cb;
          realizedYtd += realized;
          cash += proceeds;
          holdings.set(o.code, have - shares);
          basis.set(o.code, (basis.get(o.code) ?? 0) - cb);
        }
      } else {
        const unit = px * (1 + GUARD_COMMISSION);
        shares = Math.min(o.shares, Math.floor(cash / unit));
        if (shares > 0) {
          commission = shares * px * GUARD_COMMISSION;
          cash -= shares * unit;
          holdings.set(o.code, (holdings.get(o.code) ?? 0) + shares);
          basis.set(o.code, (basis.get(o.code) ?? 0) + shares * unit);
        }
      }
      o.status = "filled";
      await prisma.$transaction([
        prisma.guardOrder.update({ where: { id: o.id }, data: { status: "filled", fillDate: d, fillPrice: px } }),
        ...(shares > 0
          ? [prisma.guardTrade.create({ data: { date: d, code: o.code, side: o.side, shares, price: px, commission, realized, orderId: o.id } })]
          : []),
      ]);
      fills++;
    }
  }

  // ---- mark to market at today's close ----
  const closeOf = (code: string): number | null => {
    const b = bars.get(code);
    return b && b.c.length ? b.c[b.c.length - 1] : null;
  };
  let stockValue = 0;
  for (const [code, sh] of holdings) stockValue += sh * (closeOf(code) ?? 0);
  const value = cash + stockValue;
  const exposure = updateGuard(gs, value, PARAMS);
  const currentExp = value > 0 ? stockValue / value : 0;

  // ---- monthly target refresh (first processed session of the month) ----
  const month = today.slice(0, 7);
  let targets: string[] = JSON.parse((await getS("guardTargets")) ?? "[]");
  let refreshed = false;
  const targetCloses = new Map<string, number>();
  if ((await getS("guardTargetsMonth")) !== month) {
    const universe = await prisma.listedStock.findMany({
      where: { financials: { some: {} } },
      select: { code: true },
    });
    const feats = await mapPool(universe.map((u) => u.code), 8, async (code) => {
      const b = await fetchGuardBars(code, "2y");
      if (!b || b.t[b.t.length - 1] !== today) return null; // must trade on the signal day
      const f = guardFeatures(b);
      if (!f) return null;
      targetCloses.set(code, b.c[b.c.length - 1]);
      return { code, ...f };
    });
    const pool = feats.filter((x): x is NonNullable<typeof x> => x != null);
    if (pool.length >= 50) {
      targets = pickTargets(pool, 10);
      refreshed = true;
      await setS("guardTargets", JSON.stringify(targets));
      await setS("guardTargetsMonth", month);
    }
  }

  // ---- tonight's orders ----
  let newOrders = 0;
  const stillPending = pending.some((o) => o.status === "pending");
  if (!stillPending && (refreshed || needsResize(exposure, currentExp, PARAMS))) {
    for (const code of targets) {
      if (targetCloses.has(code) || holdings.has(code)) continue;
      const b = await fetchGuardBars(code, "1mo");
      if (b && b.t[b.t.length - 1] === today) targetCloses.set(code, b.c[b.c.length - 1]);
    }
    const price = (code: string) => targetCloses.get(code) ?? closeOf(code);
    const { orders } = planOrders({ value, exposure, targets, holdings, price });
    const reason = refreshed
      ? `月初の銘柄入替(株の目標比率 ${(exposure * 100).toFixed(0)}%)`
      : `比率調整 ${(currentExp * 100).toFixed(0)}% → ${(exposure * 100).toFixed(0)}%`;
    if (orders.length > 0) {
      await prisma.guardOrder.createMany({
        data: orders.map((o) => ({ createdDate: today, code: o.code, side: o.side, shares: o.shares, refPrice: price(o.code) ?? 0, reason })),
      });
      newOrders = orders.length;
    }
  }

  // ---- persist ----
  await prisma.$transaction([
    prisma.guardPosition.deleteMany({}),
    prisma.guardPosition.createMany({
      data: [...holdings].filter(([, sh]) => sh > 0).map(([code, shares]) => ({ code, shares, costBasis: basis.get(code) ?? 0 })),
    }),
    prisma.guardEquity.upsert({
      where: { date: today },
      create: { date: today, value, cash, stockValue, floor: gs.floor, exposure, locked: gs.locked },
      update: { value, cash, stockValue, floor: gs.floor, exposure, locked: gs.locked },
    }),
  ]);
  for (const [k, v] of [
    ["guardCash", cash], ["guardLastDate", today], ["guardLastValue", value], ["guardRealizedYtd", realizedYtd],
    ["guardYear", gs.year], ["guardYearStart", gs.startValue], ["guardFloor", gs.floor], ["guardHwm", gs.hwm], ["guardLocked", gs.locked],
  ] as const) await setS(k, v);

  return {
    date: today, session: true, note: "ok", value: Math.round(value), exposure, floor: Math.round(gs.floor),
    fills, dividends: divCount, newOrders, refreshedTargets: refreshed,
  };
}
