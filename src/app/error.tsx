"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-6 py-5 max-w-2xl">
      <h2 className="text-lg font-semibold text-red-700 dark:text-red-400">
        エラーが発生しました
      </h2>
      <p className="text-sm text-red-700 dark:text-red-400 mt-2 break-words">
        {error.message || "予期しないエラーが発生しました"}
      </p>
      {error.digest && (
        <p className="text-xs text-red-600/70 dark:text-red-400/70 mt-2 font-mono">
          digest: {error.digest}
        </p>
      )}
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-lg bg-red-600 hover:bg-red-700 px-4 py-2 text-white text-sm font-medium transition"
      >
        再試行
      </button>
    </div>
  );
}
