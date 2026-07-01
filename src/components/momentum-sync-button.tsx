"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bulkSyncMomentum } from "@/app/actions/momentum";

export function MomentumSyncButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    synced: number;
    failed: number;
    requested: number;
  } | null>(null);
  const router = useRouter();

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setResult(null);
          startTransition(async () => {
            const r = await bulkSyncMomentum();
            setResult({ synced: r.synced, failed: r.failed, requested: r.requested });
            router.refresh();
          });
        }}
        className="rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-4 py-2 text-sm font-medium hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50 transition"
      >
        {pending ? "取得中... (数十秒)" : "📈 価格モメンタム(RS/Trend Template)を一括取得"}
      </button>
      {result && !pending && (
        <span className="text-xs text-emerald-600 dark:text-emerald-400">
          ✓ {result.synced}件取得{result.failed > 0 && ` / ${result.failed}件失敗`}
        </span>
      )}
    </div>
  );
}
