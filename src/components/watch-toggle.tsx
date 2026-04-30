"use client";

import { useState, useTransition } from "react";
import { toggleWatch } from "@/app/actions/watchlist";

export function WatchToggle({
  code,
  initialWatched,
}: {
  code: string;
  initialWatched: boolean;
}) {
  const [watched, setWatched] = useState(initialWatched);
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const r = await toggleWatch(code);
          setWatched(r.watched);
        });
      }}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
        watched
          ? "bg-amber-500 text-white hover:bg-amber-600"
          : "border border-black/15 dark:border-white/15 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      }`}
    >
      {pending ? "..." : watched ? "★ ウォッチ中" : "☆ ウォッチに追加"}
    </button>
  );
}
