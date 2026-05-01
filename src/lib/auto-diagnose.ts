// Rule-based stock diagnosis - works without any external API.
// Generates a list of factual observations + interpretations from cached data.

export type DiagnosisInput = {
  scaleCategory: string | null;
  per: number | null;
  pbr: number | null;
  roe: number | null; // %
  salesYoY: number | null; // %
  profitYoY: number | null; // %
  forecastSalesYoY: number | null; // % (vs latest actual FY)
  forecastProfitYoY: number | null; // %
  equityRatio: number | null; // % (0-100)
  ret1M: number | null; // %
  ret3M: number | null; // %
  ret1Y: number | null; // %
  rangePosition: number | null; // 0-100, 0=low, 100=high
};

export type Tag = {
  text: string;
  tone: "good" | "bad" | "neutral" | "warn";
};

export function diagnose(d: DiagnosisInput): Tag[] {
  const tags: Tag[] = [];

  // Growth tags
  if (d.salesYoY != null) {
    if (d.salesYoY >= 30) tags.push({ text: `🚀 急成長 (売上+${d.salesYoY.toFixed(0)}%)`, tone: "good" });
    else if (d.salesYoY >= 15) tags.push({ text: `📈 高成長 (売上+${d.salesYoY.toFixed(0)}%)`, tone: "good" });
    else if (d.salesYoY < -5) tags.push({ text: `📉 売上減少 (${d.salesYoY.toFixed(0)}%)`, tone: "bad" });
  }

  // Forecast acceleration / deceleration
  if (d.forecastSalesYoY != null && d.salesYoY != null) {
    const accel = d.forecastSalesYoY - d.salesYoY;
    if (accel >= 5)
      tags.push({ text: `⏫ 成長加速期待 (会社予想 ${d.forecastSalesYoY.toFixed(0)}%)`, tone: "good" });
    else if (accel <= -10)
      tags.push({
        text: `⏬ 成長減速見込み (予想 ${d.forecastSalesYoY.toFixed(0)}%)`,
        tone: "warn",
      });
  } else if (d.forecastSalesYoY != null && d.forecastSalesYoY >= 15) {
    tags.push({ text: `予想成長 +${d.forecastSalesYoY.toFixed(0)}%`, tone: "good" });
  }

  // Profit growth vs sales (efficiency)
  if (d.salesYoY != null && d.profitYoY != null) {
    if (d.profitYoY > d.salesYoY + 5)
      tags.push({ text: "💎 利益率改善 (利益>売上)", tone: "good" });
    else if (d.profitYoY < d.salesYoY - 10)
      tags.push({ text: "⚠ 利益率悪化", tone: "warn" });
  }

  // Forecast guidance: company expecting profit decline?
  if (d.forecastProfitYoY != null && d.forecastProfitYoY <= -10) {
    tags.push({
      text: `⚠ 利益下方ガイダンス (${d.forecastProfitYoY.toFixed(0)}%)`,
      tone: "warn",
    });
  }

  // Profitability
  if (d.roe != null) {
    if (d.roe >= 15) tags.push({ text: `🏆 高ROE (${d.roe.toFixed(0)}%)`, tone: "good" });
    else if (d.roe < 5 && d.roe >= 0) tags.push({ text: `低ROE (${d.roe.toFixed(0)}%)`, tone: "warn" });
    else if (d.roe < 0) tags.push({ text: `❌ ROEマイナス`, tone: "bad" });
  }

  // Valuation
  if (d.per != null) {
    if (d.per < 0) tags.push({ text: "PER算定不可（赤字）", tone: "warn" });
    else if (d.per < 12 && d.salesYoY != null && d.salesYoY > 5)
      tags.push({ text: "💰 割安成長 (低PER+成長)", tone: "good" });
    else if (d.per > 50 && d.salesYoY != null && d.salesYoY < 15)
      tags.push({ text: "⚠ 割高 (高PER+成長鈍化)", tone: "warn" });
  }

  // Balance sheet strength
  if (d.equityRatio != null) {
    if (d.equityRatio >= 60) tags.push({ text: "🛡 財務健全 (自己資本60%+)", tone: "good" });
    else if (d.equityRatio < 25) tags.push({ text: "⚠ 財務リスク (自己資本25%未満)", tone: "warn" });
  }

  // Price momentum
  if (d.ret1Y != null) {
    if (d.ret1Y >= 50) tags.push({ text: `🔥 1年で +${d.ret1Y.toFixed(0)}%`, tone: "good" });
    else if (d.ret1Y <= -30) tags.push({ text: `📉 1年で ${d.ret1Y.toFixed(0)}%`, tone: "bad" });
  }
  if (d.ret1M != null && d.ret1M >= 15)
    tags.push({ text: `急騰中 (1ヶ月 +${d.ret1M.toFixed(0)}%)`, tone: "warn" });
  if (d.ret1M != null && d.ret1M <= -15)
    tags.push({ text: `急落中 (1ヶ月 ${d.ret1M.toFixed(0)}%)`, tone: "warn" });

  // Range position
  if (d.rangePosition != null) {
    if (d.rangePosition >= 90) tags.push({ text: "📌 高値圏", tone: "warn" });
    else if (d.rangePosition <= 10) tags.push({ text: "📌 安値圏", tone: "neutral" });
  }

  // Small cap target match
  if (
    (d.scaleCategory === "TOPIX Small 1" || d.scaleCategory === "TOPIX Small 2") &&
    d.salesYoY != null &&
    d.salesYoY > 15
  ) {
    tags.push({ text: "🎯 小型成長株候補", tone: "good" });
  }

  return tags;
}

export function summary(d: DiagnosisInput): string {
  const positives: string[] = [];
  const negatives: string[] = [];

  if (d.salesYoY != null && d.salesYoY >= 15) positives.push("売上が高成長");
  if (d.forecastSalesYoY != null && d.salesYoY != null && d.forecastSalesYoY > d.salesYoY)
    positives.push("会社予想は更なる加速");
  if (d.roe != null && d.roe >= 15) positives.push("資本効率が高い");
  if (d.equityRatio != null && d.equityRatio >= 50) positives.push("財務基盤が健全");
  if (d.per != null && d.per > 0 && d.per < 15) positives.push("バリュエーションは割安水準");

  if (d.salesYoY != null && d.salesYoY < 0) negatives.push("売上が前年割れ");
  if (d.forecastProfitYoY != null && d.forecastProfitYoY < -10)
    negatives.push("会社予想は利益減少を示唆");
  if (d.equityRatio != null && d.equityRatio < 25) negatives.push("財務に注意");
  if (d.rangePosition != null && d.rangePosition >= 90) negatives.push("株価は高値圏で過熱感");
  if (d.per != null && d.per > 50) negatives.push("PERが高水準");

  if (positives.length === 0 && negatives.length === 0) return "判断材料が不足しています。";

  const parts: string[] = [];
  if (positives.length > 0) parts.push(`✓ ${positives.join("、")}`);
  if (negatives.length > 0) parts.push(`△ ${negatives.join("、")}`);
  return parts.join(" / ");
}
