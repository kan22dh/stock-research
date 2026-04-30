"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { searchStocks, type StockSearchResult } from "@/app/actions/search";

export function StockSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockSearchResult[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (query.trim().length === 0) return;
    debounce.current = setTimeout(() => {
      startTransition(async () => {
        try {
          const r = await searchStocks(query);
          setResults(r);
          setError(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : "検索エラー");
          setResults([]);
        }
      });
    }, 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <input
          type="search"
          value={query}
          onChange={(e) => {
            const v = e.target.value;
            setQuery(v);
            if (v.trim() === "") {
              setResults([]);
              setError(null);
            }
          }}
          placeholder="銘柄コード（例: 7203）または銘柄名で検索"
          className="w-full rounded-xl border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-900 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white"
          autoFocus
        />
        {pending && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-neutral-500">
            検索中...
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error.includes("JQUANTS_REFRESH_TOKEN") ? (
            <>
              <strong>J-Quants の API トークンが未設定です。</strong>
              <br />
              <code className="text-xs font-mono">.env</code> の{" "}
              <code className="text-xs font-mono">JQUANTS_REFRESH_TOKEN</code> に
              リフレッシュトークンを設定後、開発サーバーを再起動してください。
            </>
          ) : (
            error
          )}
        </div>
      )}

      {query.trim() && !pending && results.length === 0 && !error && (
        <div className="text-sm text-neutral-500 px-2">該当する銘柄が見つかりませんでした</div>
      )}

      {results.length > 0 && (
        <ul className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 divide-y divide-black/5 dark:divide-white/5 overflow-hidden">
          {results.map((r) => (
            <li key={r.code}>
              <Link
                href={`/stocks/${r.code}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    <span className="font-mono text-neutral-500 mr-2">{r.ticker}</span>
                    {r.name}
                  </div>
                  <div className="text-xs text-neutral-500 mt-0.5 flex gap-2 flex-wrap">
                    {r.sector33Name && <span>{r.sector33Name}</span>}
                    {r.marketName && (
                      <span className="text-neutral-400">・{r.marketName}</span>
                    )}
                    {r.scaleCategory && (
                      <span className="text-neutral-400">・{r.scaleCategory}</span>
                    )}
                  </div>
                </div>
                <span className="text-neutral-400 shrink-0">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
