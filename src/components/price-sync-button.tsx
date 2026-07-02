"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function PriceSyncButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setResult(null);
          startTransition(async () => {
            try {
              const res = await fetch("/api/sync-prices?limit=400", {
                method: "POST",
              });
              const j = (await res.json()) as {
                synced: number;
                skipped: number;
                failed: number;
              };
              setResult(
                `✓ ${j.synced}件取得 / ${j.skipped}件は取得済み${j.failed > 0 ? ` / ${j.failed}件失敗` : ""}`,
              );
              router.refresh();
            } catch {
              setResult("⚠ 取得に失敗しました");
            }
          });
        }}
        className="rounded-lg bg-neutral-900 dark:bg-white px-4 py-2 text-white dark:text-neutral-900 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
      >
        {pending ? "取得中... (1〜2分かかります)" : "📥 全銘柄の株価履歴(5年分)を取得"}
      </button>
      {result && !pending && (
        <span className="text-xs text-emerald-600 dark:text-emerald-400">{result}</span>
      )}
    </div>
  );
}
