import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5-20251001"; // fast + cheap for short analyses

export function isAiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY?.trim();
}

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

export type StockContext = {
  ticker: string;
  name: string;
  sector33Name: string | null;
  marketName: string | null;
  scaleCategory: string | null;
  latestPrice: number | null;
  priceChangePct1Year: number | null;
  per: number | null;
  pbr: number | null;
  roe: number | null;
  salesYoY: number | null;
  profitYoY: number | null;
  recentAnnual: Array<{
    fiscalYearEnd: string;
    netSales: number | null;
    netIncome: number | null;
    eps: number | null;
  }>;
  macroContext?: Array<{
    label: string;
    value: number | null;
    yoy: number | null;
    unit: string;
  }>;
};

const SYSTEM_PROMPT = `あなたは、日本株（特に小型成長株）の投資判断を支援するアシスタントです。

ユーザーは新NISAで小型成長株（時価総額500億円以下、1〜2年で2-3倍を狙う）への投資を検討しています。
入力されるデータは個別銘柄の財務指標・株価変動・主要マクロ指標です。

以下の観点で「短く・具体的に・正直に」コメントしてください:
1. **企業の現状診断** (1-2文): 売上/利益/ROEから今の状態を一言
2. **成長性評価** (1-2文): 売上YoY・純利益YoYから1〜2年で2-3倍化のポテンシャル
3. **マクロ環境との関係** (1-2文): 業種×現在の金利/為替/原油から逆風 or 順風か
4. **注意点・リスク** (1-2文): バリュエーション過熱、業績ブレ、規模の小ささ等
5. **総合スタンス** (1行): 「観察候補/打診買い候補/見送り推奨/判断保留」のいずれか

- ハルシネーション禁止: 入力データに無い情報（具体的な戦略・経営陣・競合）は推測しない
- 投資助言ではないことを明記: 末尾に「※投資判断はご自身で」と添える
- 全体で250〜400字程度の日本語`;

export async function analyzeStock(ctx: StockContext): Promise<string> {
  const client = getClient();

  const userPrompt = formatContext(ctx);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" }, // cache the system prompt
      },
    ],
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();

  return text;
}

function formatContext(ctx: StockContext): string {
  const lines: string[] = [];
  lines.push(`# 銘柄: ${ctx.ticker} ${ctx.name}`);
  lines.push(`業種: ${ctx.sector33Name ?? "—"} / 市場: ${ctx.marketName ?? "—"} / 規模: ${ctx.scaleCategory ?? "—"}`);
  lines.push("");
  lines.push("## 株価");
  lines.push(`現在値: ${fmt(ctx.latestPrice)}円`);
  lines.push(`過去1年の値動き: ${fmtPct(ctx.priceChangePct1Year)}`);
  lines.push("");
  lines.push("## 財務指標（直近通期）");
  lines.push(`PER: ${fmt(ctx.per)}倍 / PBR: ${fmt(ctx.pbr)}倍 / ROE: ${fmtPct(ctx.roe)}`);
  lines.push(`売上YoY: ${fmtPct(ctx.salesYoY)} / 純利益YoY: ${fmtPct(ctx.profitYoY)}`);
  lines.push("");
  if (ctx.recentAnnual.length > 0) {
    lines.push("## 業績推移");
    for (const a of ctx.recentAnnual.slice(-4)) {
      lines.push(
        `- ${a.fiscalYearEnd}: 売上 ${fmtMoney(a.netSales)} / 純利益 ${fmtMoney(a.netIncome)} / EPS ${fmt(a.eps)}円`,
      );
    }
    lines.push("");
  }
  if (ctx.macroContext && ctx.macroContext.length > 0) {
    lines.push("## マクロ環境（直近）");
    for (const m of ctx.macroContext) {
      lines.push(`- ${m.label}: ${fmt(m.value)}${m.unit} (YoY ${fmtPct(m.yoy)})`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function fmt(v: number | null): string {
  if (v == null) return "—";
  return v.toFixed(2);
}
function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return `${v.toFixed(2)}%`;
}
function fmtMoney(v: number | null): string {
  if (v == null) return "—";
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(1)}億円`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(1)}万円`;
  return `${v.toFixed(0)}円`;
}
