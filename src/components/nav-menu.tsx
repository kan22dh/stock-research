"use client";

import { useState } from "react";
import Link from "next/link";

const NAV_ITEMS = [
  { href: "/", label: "銘柄検索" },
  { href: "/positions", label: "ポジション" },
  { href: "/watchlist", label: "ウォッチリスト" },
  { href: "/screener", label: "スクリーナー" },
  { href: "/compare", label: "比較" },
  { href: "/sectors", label: "業界" },
  { href: "/macro", label: "マクロ" },
];

export function NavMenu() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Desktop nav (hidden on small screens) */}
      <nav className="hidden md:flex items-center gap-4 text-sm">
        {NAV_ITEMS.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className="text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition"
          >
            {it.label}
          </Link>
        ))}
      </nav>

      {/* Mobile hamburger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg border border-black/15 dark:border-white/15 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        aria-label="メニュー"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {open ? (
            <>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </>
          ) : (
            <>
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </>
          )}
        </svg>
      </button>

      {/* Mobile menu drop */}
      {open && (
        <div className="md:hidden absolute top-full left-0 right-0 border-b border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 shadow-lg z-10">
          <nav className="flex flex-col py-2">
            {NAV_ITEMS.map((it) => (
              <Link
                key={it.href}
                href={it.href}
                onClick={() => setOpen(false)}
                className="px-6 py-3 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition"
              >
                {it.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </>
  );
}
