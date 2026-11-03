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
//      orders (the owner enters them 14:00–07:00 → fill at the next open)
// Idempotent: one equity row per date, one fill per order, one dividend
// credit per (code, ex-date), tax settled once per year. A Japanese market
// holiday is a successful no-op (no 1306 bar for today).
//
// Crash safety: the session loop only mutates memory; its effects (fills,
// trades, dividends, positions, cash, year state) commit in ONE transaction
// before the heavy monthly universe pass, and the month's targets + tonight's
// orders + the day's equity row commit together in a second one. A missing
// quote fails the run before anything is written.

import { Prisma } from "@prisma/client";
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
const EARLIEST_RUN_HOUR_JST = 16; // the close is 15:30; never mark on a partial bar

async function getS(key: string): Promise<string | null> {
  return (await prisma.appSetting.findUnique({ where: { key } }))?.value ?? null;
}

function settingWrites(kv: [string, string | number | boolean][]) {
  return kv.map(([key, v]) =>
    prisma.appSetting.upsert({ where: { key }, create: { key, value: String(v) }, update: { value: String(v) } }),
  );
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
  if (opts.asOf && opts.asOf >= jstToday()) throw new Error("asOf は過去の営業日のみ指定できます");
  const today = opts.asOf ?? jstToday();

  // Trading-day check from 1306's own calendar.
  const bench = await fetchGuardBars("13060", "3mo");
  if (!bench) throw new Error("benchmark 1306: Yahoo returned no data");
  const latest = bench.t[bench.t.length - 1];
  if (latest !== today) {
    return { date: today, session: false, note: `立会なし(休日/未公表)。1306最新足 ${latest}` };
  }
  // During the session today's bar is partial: processing now would mark the
  // day at intraday prices and turn the real evening run into a no-op.
  // Refuse as a FAILURE so health stays red and the 17:00 slot does the work.
  const jstHour = new Date(Date.now() + 9 * 3600 * 1000).getUTCHours();
  if (!opts.asOf && jstHour < EARLIEST_RUN_HOUR_JST) {
    throw new Error(`市場時間中(${jstHour}時台)は処理しません。終値確定後(${EARLIEST_RUN_HOUR_JST}時以降)に実行します`);
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
  for (const [code, b] of await mapPool(codes, 6, async (c) => [c, await fetchGuardBars(c, "3mo")] as const)) {
    if (b) bars.set(code, b);
  }
  // A missing quote must not be valued at ¥0 (it could eat the cushion and
  // lock the year) or burn a pending order's retries: fail before writing.
  const missing = codes.filter((c) => !bars.has(c));
  if (missing.length > 0) throw new Error(`株価を取得できない銘柄があります: ${missing.join(", ")}`);

  // ---- process sessions in memory ----
  const sessions = lastDate ? bench.t.filter((d) => d > lastDate && d <= today) : [today];
  let fills = 0;
  let divCount = 0;
  let lastValue = Number((await getS("guardLastValue")) ?? cash);
  const writes: Prisma.PrismaPromise<unknown>[] = [];
  const settings: [string, string | number | boolean][] = [];

  for (const d of sessions) {
    // Year rollover: settle last year's capital-gains tax once, then reset.
    if (Number(d.slice(0, 4)) !== gs.year) {
      if (!(await getS(`guardTaxSettled:${gs.year}`))) {
        const cgt = Math.max(0, realizedYtd) * TAX_RATE;
        cash -= cgt;
        lastValue -= cgt;
        settings.push([`guardTaxSettled:${gs.year}`, Math.round(cgt)]);
      }
      realizedYtd = 0;
      gs = newYear(Number(d.slice(0, 4)), lastValue, PARAMS);
    }

    // Dividends on shares held at the previous close.
    for (const [code, sh] of holdings) {
      if (sh <= 0) continue;
      for (const [exd, amt] of bars.get(code)!.divs) {
        if (exd !== d) continue;
        if (await prisma.guardDividend.findUnique({ where: { code_exDate: { code, exDate: exd } } })) continue;
        const gross = sh * amt;
        cash += gross * (1 - TAX_RATE);
        writes.push(prisma.guardDividend.create({ data: { code, exDate: exd, shares: sh, gross, tax: gross * TAX_RATE } }));
        divCount++;
      }
    }

    // Fills at this session's open: sells first, then buys (cash-limited).
    const due = pending.filter((o) => o.status === "pending" && o.createdDate < d);
    for (const o of [...due.filter((x) => x.side === "sell"), ...due.filter((x) => x.side === "buy")]) {
      const b = bars.get(o.code)!;
      const i = b.t.indexOf(d);
      if (i < 0 || !(b.o[i] > 0)) {
        const waited = bench.t.filter((x) => x > o.createdDate && x <= d).length;
        if (waited >= ORDER_EXPIRY_SESSIONS) {
          o.status = "expired";
          writes.push(prisma.guardOrder.update({ where: { id: o.id }, data: { status: "expired" } }));
        }
        continue;
      }
      const px = b.o[i];
      let shares = 0;
      let realized: number | null = null;
      let commission = 0;
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
      writes.push(prisma.guardOrder.update({ where: { id: o.id }, data: { status: "filled", fillDate: d, fillPrice: px } }));
      if (shares > 0) {
        writes.push(
          prisma.guardTrade.create({ data: { date: d, code: o.code, side: o.side, shares, price: px, commission, realized, orderId: o.id } }),
        );
      }
      fills++;
    }
  }

  // ---- mark to market at today's close ----
  const closeOf = (code: string): number | null => {
    const b = bars.get(code);
    return b && b.c.length ? b.c[b.c.length - 1] : null;
  };
  let stockValue = 0;
  for (const [code, sh] of holdings) if (sh > 0) stockValue += sh * closeOf(code)!;
  const value = cash + stockValue;
  const exposure = updateGuard(gs, value, PARAMS);
  const currentExp = value > 0 ? stockValue / value : 0;

  // Commit 1 — before the heavy universe pass.
  await prisma.$transaction([
    ...writes,
    prisma.guardPosition.deleteMany({}),
    prisma.guardPosition.createMany({
      data: [...holdings].filter(([, sh]) => sh > 0).map(([code, shares]) => ({ code, shares, costBasis: basis.get(code) ?? 0 })),
    }),
    ...settingWrites([
      ...settings,
      ["guardCash", cash], ["guardLastDate", today], ["guardLastValue", value], ["guardRealizedYtd", realizedYtd],
      ["guardYear", gs.year], ["guardYearStart", gs.startValue], ["guardFloor", gs.floor], ["guardHwm", gs.hwm],
      ["guardLocked", gs.locked],
    ]),
  ]);

  // ---- monthly target refresh (first processed session of the month) ----
  const month = today.slice(0, 7);
  let targets: string[] = JSON.parse((await getS("guardTargets")) ?? "[]");
  let refreshed = false;
  const targetCloses = new Map<string, number>();
  if ((await getS("guardTargetsMonth")) !== month) {
    const universe = await prisma.listedStock.findMany({ where: { financials: { some: {} } }, select: { code: true } });
    const feats = await mapPool(universe.map((u) => u.code), 8, async (code) => {
      const b = await fetchGuardBars(code, "2y");
      if (!b || b.t[b.t.length - 1] !== today) return null; // must trade on the signal day
      const f = guardFeatures(b);
      if (!f) return null;
      targetCloses.set(code, b.c[b.c.length - 1]);
      return { code, ...f };
    });
    const pool = feats.filter((x): x is NonNullable<typeof x> => x != null);
    if (pool.length < 50) throw new Error(`銘柄データ不足(${pool.length}銘柄)のため月初の銘柄更新を中止`);
    targets = pickTargets(pool, 10);
    refreshed = true;
  }

  // ---- tonight's orders ----
  const orderRows: Prisma.GuardOrderCreateManyInput[] = [];
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
    for (const o of orders) {
      orderRows.push({ createdDate: today, code: o.code, side: o.side, shares: o.shares, refPrice: price(o.code) ?? 0, reason });
    }
  }

  // Commit 2 — targets, tonight's orders and the equity row (which marks the
  // day as done for retries) together.
  await prisma.$transaction([
    ...(refreshed ? settingWrites([["guardTargets", JSON.stringify(targets)], ["guardTargetsMonth", month]]) : []),
    ...(orderRows.length ? [prisma.guardOrder.createMany({ data: orderRows })] : []),
    prisma.guardEquity.upsert({
      where: { date: today },
      create: { date: today, value, cash, stockValue, floor: gs.floor, exposure, locked: gs.locked },
      update: { value, cash, stockValue, floor: gs.floor, exposure, locked: gs.locked },
    }),
  ]);

  return {
    date: today, session: true, note: "ok", value: Math.round(value), exposure, floor: Math.round(gs.floor),
    fills, dividends: divCount, newOrders: orderRows.length, refreshedTargets: refreshed,
  };
}
