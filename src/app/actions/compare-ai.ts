"use server";

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { isAiEnabled } from "@/lib/ai";

const MODEL = "claude-haiku-4-5-20251001";

export type CompareAiResult =
  | { ok: true; analysis: string }
  | { ok: false; reason: "no-key" | "no-data" | "error"; message?: string };

export async function compareWithAi(codes: string[]): Promise<CompareAiResult> {
  if (!isAiEnabled()) return { ok: false, reason: "no-key" };
  if (codes.length !== 2) {
    return { ok: false, reason: "no-data", message: "2銘柄を指定してください" };
  }

  const stocks = await Promise.all(
    codes.map(async (code) => {
      const [stock, prices, fin] = await Promise.all([
        prisma.listedStock.findUnique({ where: { code } }),
        prisma.priceCache.findMany({
          where: { code },
          orderBy: { date: "desc" },
          take: 1,
        }),
        prisma.financialCache.findMany({
          where: { code },
          orderBy: { fiscalYearEnd: "desc" },
          take: 1,
        }),
      ]);
      return { stock, latestPrice: prices[0]?.close ?? null, fin: fin[0] ?? null };
    }),
  );

  if (stocks.some((s) => !s.stock)) {
    return { ok: false, reason: "no-data", message: "銘柄データが揃いません" };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { ok: false, reason: "no-key" };
  const client = new Anthropic({ apiKey });

  const userPrompt = stocks
    .map(
      (s, i) =>
        `## ${i === 0 ? "A" : "B"}: ${s.stock!.ticker} ${s.stock!.name}
業種: ${s.stock!.sector33Name ?? "—"} / 規模: ${s.stock!.scaleCategory ?? "—"}
株価: ${s.latestPrice ?? "—"}円
売上(直近通期): ${s.fin?.netSales ?? "—"}円  純利益: ${s.fin?.netIncome ?? "—"}円
EPS: ${s.fin?.eps ?? "—"}  ROE: ${s.fin?.netIncome != null && s.fin?.equity ? ((s.fin.netIncome / s.fin.equity) * 100).toFixed(1) + "%" : "—"}
売上YoY: ${s.fin?.salesYoY?.toFixed(1) ?? "—"}%  純利益YoY: ${s.fin?.profitYoY?.toFixed(1) ?? "—"}%`,
    )
    .join("\n\n");

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 700,
      system: [
        {
          type: "text",
          text: `あなたは日本株（特に小型成長株）の比較分析アシスタントです。
ユーザーは新NISAで小型成長株（時価総額500億円以下、1〜2年で2-3倍を狙う）を選定中。
2銘柄の比較データから、以下を「短く・具体的に・正直に」述べてください:
1. 各社の現状（成長性・収益性）
2. どちらが「成長スピード」で優位か
3. どちらが「割安感」で優位か
4. 投資妙味のスタンス（A優位 / B優位 / 分散保有 / どちらも見送り）
5. 注意点
全体300〜400字程度。投資助言ではないと末尾に明記。`,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userPrompt }],
    });

    const text = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .filter(Boolean)
      .join("\n")
      .trim();

    return { ok: true, analysis: text };
  } catch (e) {
    return {
      ok: false,
      reason: "error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
