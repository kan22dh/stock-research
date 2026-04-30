"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bulkSyncFinancials } from "@/app/actions/screener";

export function BulkSyncButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    synced: number;
    failed: number;
    requested: number;
  } | null>(null);
  const router = useRouter();

  const allFailed = result != null && result.synced === 0 && result.failed > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setResult(null);
            startTransition(async () => {
              const r = await bulkSyncFinancials();
              setResult({ synced: r.synced, failed: r.failed, requested: r.requested });
              router.refresh();
            });
          }}
          className="rounded-lg bg-neutral-900 dark:bg-white px-4 py-2 text-white dark:text-neutral-900 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
        >
          {pending ? "取得中... (約3分かかります)" : "📊 未取得の小型株30件をまとめて取得"}
        </button>
        {result && !pending && (
          <span
            className={`text-xs ${
              result.synced > 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-amber-600 dark:text-amber-400"
            }`}
          >
            {result.synced > 0
              ? `✓ ${result.synced}件取得`
              : `⚠ 0件取得（レート制限の可能性）`}
            {result.failed > 0 && ` / ${result.failed}件失敗`}
          </span>
        )}
      </div>
      {allFailed && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-400 max-w-2xl">
          <strong>J-Quants 無料プランのレート制限に達しました。</strong>
          数十分〜1時間後に再度お試しください。すでに取得済みの銘柄でスクリーニングは可能です。
        </div>
      )}
    </div>
  );
}
