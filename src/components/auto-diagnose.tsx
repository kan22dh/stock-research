import { diagnose, summary, type DiagnosisInput, type Tag } from "@/lib/auto-diagnose";

export function AutoDiagnose({ input }: { input: DiagnosisInput }) {
  const tags = diagnose(input);
  const oneLineSummary = summary(input);

  if (tags.length === 0) return null;

  return (
    <section className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-5 space-y-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <span>📋</span>自動診断
        </h2>
        <span className="text-xs text-neutral-500">ルールベース・APIキー不要</span>
      </div>

      <div className="text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed">
        {oneLineSummary}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {tags.map((t, i) => (
          <TagPill key={i} tag={t} />
        ))}
      </div>
    </section>
  );
}

function TagPill({ tag }: { tag: Tag }) {
  const cls =
    tag.tone === "good"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/60"
      : tag.tone === "bad"
        ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/60"
        : tag.tone === "warn"
          ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/60"
          : "bg-neutral-100 text-neutral-700 border-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:border-neutral-700";
  return (
    <span className={`text-xs px-2.5 py-1 rounded-full border ${cls}`}>
      {tag.text}
    </span>
  );
}
