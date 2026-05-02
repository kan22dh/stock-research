"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncPeersFinancials } from "@/app/actions/sync-peers";

export function SyncPeersButton({
  peerCodes,
  selfCode,
}: {
  peerCodes: string[];
  selfCode: string;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ synced: number; failed: number } | null>(
    null,
  );
  const router = useRouter();

  if (peerCodes.length === 0) return null;

  return (
    <div className="flex items-center gap-3 flex-wrap text-xs">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setResult(null);
          startTransition(async () => {
            const r = await syncPeersFinancials(peerCodes, { selfCode });
            setResult({ synced: r.synced, failed: r.failed });
            router.refresh();
          });
        }}
        className="rounded-full border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-3 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition disabled:opacity-50"
      >
        {pending
          ? `📊 取得中… (${peerCodes.length}社, 約${Math.ceil((peerCodes.length * 6) / 60)}分)`
          : `📊 同業他社 ${peerCodes.length}社の財務を一括取得`}
      </button>
      {result && (
        <span
          className={`${
            result.synced > 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-amber-600 dark:text-amber-400"
          }`}
        >
          {result.synced > 0 ? `✓ ${result.synced}社取得` : `⚠ レート制限`}
          {result.failed > 0 && ` / ${result.failed}失敗`}
        </span>
      )}
    </div>
  );
}
