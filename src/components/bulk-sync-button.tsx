"use client";

import { useState, useTransition } from "react";
import { bulkSyncFinancials } from "@/app/actions/screener";

export function BulkSyncButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setResult(null);
          startTransition(async () => {
            const r = await bulkSyncFinancials();
            setResult(`取得完了: ${r.synced}件成功 / ${r.failed}件失敗 (合計${r.requested}件)`);
          });
        }}
        className="rounded-lg bg-neutral-900 dark:bg-white px-4 py-2 text-white dark:text-neutral-900 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
      >
        {pending ? "取得中... (1〜2分かかります)" : "📊 小型株50件の財務データを取得"}
      </button>
      {result && (
        <span className="text-xs text-neutral-600 dark:text-neutral-400">{result}</span>
      )}
    </div>
  );
}
