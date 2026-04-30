"use client";

import { useState, useTransition } from "react";
import { analyzeStockAction, type AnalyzeResult } from "@/app/actions/analyze";

export function AiAnalyze({ code, aiEnabled }: { code: string; aiEnabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AnalyzeResult | null>(null);

  return (
    <section className="rounded-2xl border border-violet-200 dark:border-violet-900/50 bg-gradient-to-br from-violet-50 to-white dark:from-violet-950/30 dark:to-neutral-900 p-5 space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <span className="text-violet-600 dark:text-violet-400">✦</span>
          AI 分析（Claude Haiku 4.5）
        </h2>
        <span className="text-xs text-neutral-500">
          財務 + マクロ環境を統合し短評
        </span>
      </div>

      {!aiEnabled ? (
        <div className="text-xs text-neutral-600 dark:text-neutral-400 rounded-lg bg-white dark:bg-neutral-900/50 px-3 py-2.5 border border-black/5 dark:border-white/5">
          AI 分析を有効にするには <code className="font-mono">.env</code> の{" "}
          <code className="font-mono">ANTHROPIC_API_KEY</code> に Claude API キーを設定してください。{" "}
          <a
            href="https://console.anthropic.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-neutral-900 dark:hover:text-white"
          >
            console.anthropic.com
          </a>
          {" "}で取得できます。
        </div>
      ) : (
        <div className="space-y-3">
          {!result && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  const r = await analyzeStockAction(code);
                  setResult(r);
                });
              }}
              className="rounded-lg bg-violet-600 hover:bg-violet-700 px-4 py-2 text-white text-sm font-medium disabled:opacity-50 transition"
            >
              {pending ? "分析中..." : "✦ この銘柄をAIに分析させる"}
            </button>
          )}

          {result && result.ok && (
            <div className="rounded-lg bg-white dark:bg-neutral-900/70 border border-black/5 dark:border-white/5 p-4 text-sm whitespace-pre-wrap leading-relaxed">
              {result.analysis}
            </div>
          )}

          {result && !result.ok && (
            <div className="text-xs text-red-600 dark:text-red-400">
              {result.reason === "no-key" && "APIキーが未設定です"}
              {result.reason === "no-data" && (result.message ?? "データ不足")}
              {result.reason === "error" && `エラー: ${result.message ?? ""}`}
            </div>
          )}

          {result && (
            <button
              type="button"
              onClick={() => setResult(null)}
              className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white underline"
            >
              再分析
            </button>
          )}
        </div>
      )}
    </section>
  );
}
