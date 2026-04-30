export default function Loading() {
  return (
    <div className="flex flex-col items-center justify-center py-16 space-y-3">
      <div className="h-8 w-8 rounded-full border-2 border-neutral-300 dark:border-neutral-700 border-t-neutral-900 dark:border-t-white animate-spin" />
      <p className="text-xs text-neutral-500">読み込み中...</p>
    </div>
  );
}
