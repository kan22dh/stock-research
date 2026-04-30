import Link from "next/link";

export default function NotFound() {
  return (
    <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 px-6 py-8 text-center max-w-md mx-auto">
      <h1 className="text-lg font-bold">銘柄が見つかりません</h1>
      <p className="text-sm text-neutral-500 mt-2">
        指定された銘柄コードはJ-Quants上場リストに存在しません。
      </p>
      <Link
        href="/"
        className="inline-block mt-4 rounded-lg bg-neutral-900 dark:bg-white px-4 py-2 text-white dark:text-neutral-900 text-sm font-medium hover:opacity-90"
      >
        銘柄検索に戻る
      </Link>
    </div>
  );
}
