"use client";

import { useState, useTransition } from "react";
import { compareWithAi, type CompareAiResult } from "@/app/actions/compare-ai";

export function CompareAi({ codes, aiEnabled }: { codes: string[]; aiEnabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CompareAiResult | null>(null);

  if (codes.length !== 2) return null;

  if (!aiEnabled) {
    return (
      <div className="rounded-2xl border border-violet-200 dark:border-violet-900/50 bg-violet-50 dark:bg-violet-950/20 px-4 py-3 text-xs text-violet-700 dark:text-violet-400">
        ✦ AI比較を有効にするには .env に <code className="font-mono">ANTHROPIC_API_KEY</code> を設定してください。
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-violet-200 dark:border-violet-900/50 bg-gradient-to-br from-violet-50 to-white dark:from-violet-950/30 dark:to-neutral-900 p-5 space-y-3">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <span className="text-violet-600 dark:text-violet-400">✦</span>
        AI 比較分析
      </h2>

      {!result && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              const r = await compareWithAi(codes);
              setResult(r);
            });
          }}
          className="rounded-lg bg-violet-600 hover:bg-violet-700 px-4 py-2 text-white text-sm font-medium disabled:opacity-50 transition"
        >
          {pending ? "比較中..." : "✦ 2銘柄をAIに比較させる"}
        </button>
      )}

      {result && result.ok && (
        <>
          <div className="rounded-lg bg-white dark:bg-neutral-900/70 border border-black/5 dark:border-white/5 p-4 text-sm whitespace-pre-wrap leading-relaxed">
            {result.analysis}
          </div>
          <button
            type="button"
            onClick={() => setResult(null)}
            className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white underline"
          >
            再分析
          </button>
        </>
      )}

      {result && !result.ok && (
        <div className="text-xs text-red-600 dark:text-red-400">
          {result.reason === "no-key" && "APIキー未設定"}
          {result.reason === "no-data" && (result.message ?? "データ不足")}
          {result.reason === "error" && `エラー: ${result.message}`}
        </div>
      )}
    </section>
  );
}
