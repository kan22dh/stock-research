import { prisma } from "@/lib/db";
import { fetchYahoo } from "@/lib/yahoo-finance";
import {
  computeMomentumMetrics,
  computeRSRatings,
  computeVcp,
  rsRatingColor,
  validBarIndices,
} from "@/lib/momentum";
import { syncMomentumIfStale } from "@/lib/momentum-sync";

// Stock-detail technical panel: RS Rating (vs whole cached universe),
// the 8-point Trend Template checklist, and VCP setup status with pivot.
export async function TechnicalPanel({ code }: { code: string }) {
  await syncMomentumIfStale(code).catch(() => null);

  const [momentumRows, quote] = await Promise.all([
    prisma.momentum.findMany({ select: { code: true, rsRaw: true } }),
    fetchYahoo(code, "2y", 300).catch(() => null),
  ]);
  const rsRating = computeRSRatings(momentumRows).get(code) ?? null;

  if (!quote || quote.bars.length < 60) return null;
  const clean = validBarIndices(quote.bars.map((b) => b.close)).map(
    (i) => quote.bars[i],
  );
  const m = computeMomentumMetrics(
    clean.map((b) => ({ close: b.adjClose ?? b.close })),
  );
  const vcp = computeVcp(clean);
  if (!m) return null;

  const rsPass = rsRating != null && rsRating >= 70;
  const allConditions = [
    ...m.conditions,
    {
      label: "RS Rating ≥ 70(全銘柄中の上位30%)",
      pass: rsPass,
    },
  ];
  const passCount = allConditions.filter((c) => c.pass).length;
  const livePrice = quote.regularMarketPrice ?? clean[clean.length - 1].close;

  return (
    <section className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          📐 テクニカル状態(Minervini基準)
        </h2>
        <div className="flex items-center gap-3">
          {rsRating != null && (
            <span className="text-sm">
              RS{" "}
              <span className={`text-lg font-bold tabular-nums ${rsRatingColor(rsRating)}`}>
                {rsRating}
              </span>
            </span>
          )}
          <span
            className={`text-xs rounded-full px-2.5 py-1 font-medium ${
              passCount === 8
                ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400"
                : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
            }`}
          >
            Trend Template {passCount}/8
          </span>
        </div>
      </div>

      <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        {allConditions.map((c) => (
          <li key={c.label} className="flex items-start gap-2">
            <span className={c.pass ? "text-emerald-500" : "text-neutral-300 dark:text-neutral-600"}>
              {c.pass ? "✓" : "✗"}
            </span>
            <span
              className={
                c.pass
                  ? "text-neutral-700 dark:text-neutral-300"
                  : "text-neutral-400 dark:text-neutral-500"
              }
            >
              {c.label}
            </span>
          </li>
        ))}
      </ul>

      {vcp && (
        <div
          className={`rounded-xl px-4 py-3 text-sm ${
            vcp.vcpPass
              ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300"
              : "bg-neutral-50 dark:bg-neutral-800/40 text-neutral-600 dark:text-neutral-400"
          }`}
        >
          {vcp.vcpPass ? (
            <>
              🧨 <strong>VCPセットアップ検出</strong> — 値幅収縮
              {(vcp.tightness * 100).toFixed(1)}%・出来高枯れ・高値圏。ピボット{" "}
              <strong>¥{Math.round(vcp.pivot).toLocaleString()}</strong>
              (現在値¥{Math.round(livePrice).toLocaleString()}
              から{(((vcp.pivot - livePrice) / livePrice) * 100).toFixed(1)}
              %)を出来高を伴って超えたらエントリー候補。損切りは買値-7〜8%に設定。
            </>
          ) : (
            <>
              VCPセットアップ未形成(値幅収縮
              {(vcp.tightness * 100).toFixed(1)}% / 収縮傾向{vcp.contracting ? "✓" : "✗"} /
              出来高枯れ{vcp.volumeDryUp ? "✓" : "✗"} / 高値圏{vcp.nearHigh ? "✓" : "✗"})
            </>
          )}
        </div>
      )}

      <p className="text-xs text-neutral-500">
        Trend Template全通過(8/8)は「買ってよい状態」の必要条件であって買いシグナルではありません。エントリーはVCPピボット超え等の具体的なトリガーで。
      </p>
    </section>
  );
}
