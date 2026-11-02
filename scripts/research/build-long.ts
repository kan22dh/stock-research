// Round-2 dataset: daily bars from 2000 (Yahoo period1 — `range=max` silently
// downsamples to monthly) plus dividend events, one JSON file per series in
// .cache/long/. Local only: nothing is written to the production DB.
// Also fetches 1570 (Nikkei leveraged ETF) and ^N225 for trial 21.
// Run: npx tsx scripts/research/build-long.ts
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../../src/lib/db";
import { toYahooSymbol } from "../../src/lib/yahoo-finance";
import { validBarIndices } from "../../src/lib/momentum";

const DIR = path.join(__dirname, "..", "..", ".cache", "long");
const P1 = Math.floor(Date.UTC(2000, 0, 1) / 1000);
const CONCURRENCY = 6;

type Chart = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      events?: { dividends?: Record<string, { date: number; amount: number }> };
      indicators: {
        quote: Array<{ close: (number | null)[]; volume: (number | null)[] }>;
        adjclose?: Array<{ adjclose: (number | null)[] }>;
      };
    }>;
  };
};

async function fetchLong(symbol: string) {
  const p2 = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${P1}&period2=${p2}&events=div`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as Chart;
      const r = j.chart?.result?.[0];
      if (!r?.timestamp) return null;
      const q = r.indicators.quote[0];
      const adj = r.indicators.adjclose?.[0]?.adjclose;
      const t: string[] = [], a: number[] = [], c: number[] = [], v: number[] = [];
      r.timestamp.forEach((ts, k) => {
        const close = q.close[k];
        if (close == null || !(close > 0)) return;
        t.push(new Date((ts + 9 * 3600) * 1000).toISOString().slice(0, 10));
        c.push(close);
        a.push(adj?.[k] ?? close);
        v.push(q.volume[k] ?? 0);
      });
      const keep = validBarIndices(c);
      const divs = Object.values(r.events?.dividends ?? {})
        .map((d) => [new Date((d.date + 9 * 3600) * 1000).toISOString().slice(0, 10), d.amount] as [string, number])
        .sort((x, y) => x[0].localeCompare(y[0]));
      return {
        t: keep.map((k) => t[k]),
        a: keep.map((k) => +a[k].toPrecision(7)),
        c: keep.map((k) => +c[k].toPrecision(7)),
        v: keep.map((k) => Math.round(v[k])),
        divs,
      };
    } catch {
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
    }
  }
  return null;
}

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  const stocks = await prisma.listedStock.findMany({
    where: { OR: [{ financials: { some: {} } }, { code: "13060" }] },
    select: { code: true, name: true, sector33Name: true, scaleCategory: true, marketName: true },
    orderBy: { ticker: "asc" },
  });
  await prisma.$disconnect();
  const jobs = [
    ...stocks.map((s) => ({ symbol: toYahooSymbol(s.code), meta: s })),
    { symbol: "1570.T", meta: { code: "15700", name: "日経レバ", sector33Name: null, scaleCategory: null, marketName: null } },
    { symbol: "^N225", meta: { code: "N225", name: "日経平均", sector33Name: null, scaleCategory: null, marketName: null } },
  ];
  let cursor = 0, ok = 0, fail = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const j = jobs[cursor++];
      const file = path.join(DIR, `${j.meta.code.replace(/[^A-Za-z0-9]/g, "_")}.json`);
      if (fs.existsSync(file)) { ok++; continue; } // resumable
      const d = await fetchLong(j.symbol);
      if (!d || d.t.length < 60) { fail++; continue; }
      fs.writeFileSync(file, JSON.stringify({
        code: j.meta.code, name: j.meta.name, sector: j.meta.sector33Name,
        scale: j.meta.scaleCategory, market: j.meta.marketName, ...d,
      }));
      ok++;
      if ((ok + fail) % 100 === 0) console.log(`  ${ok + fail}/${jobs.length} (fail ${fail})`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`done: ok ${ok}, fail ${fail} → ${DIR}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
