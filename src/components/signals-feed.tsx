import Link from "next/link";
import { prisma } from "@/lib/db";
import { computeRSRatings } from "@/lib/momentum";

// Home feed of the latest cron-generated signals (pivot breakouts, new VCP
// setups, stop-raise suggestions). Renders nothing until the first cron run.
//
// Breakouts are graded against the three backtest-verified buy criteria
// (RS Rating >=70 / Trend Template / sales YoY >=10%) and shown with an
// explicit 買い候補/見送り verdict, so the page itself answers "should I act?"
// instead of leaving the reader to cross-check three other screens.

type Criteria = {
  rs: number | null;
  tt: boolean | null;
  salesYoY: number | null;
  fy: string | null;
  fromPayload: boolean; // true = frozen at signal time; false = today's data
};

function gatePass(c: Criteria): boolean {
  return (
    c.rs != null && c.rs >= 70 && c.tt === true && c.salesYoY != null && c.salesYoY >= 10
  );
}

function CriteriaBadge({
  ok,
  label,
}: {
  ok: boolean | null;
  label: string;
}) {
  const cls =
    ok == null
      ? "bg-neutral-100 dark:bg-neutral-800 text-neutral-500"
      : ok
        ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400"
        : "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>
      {ok == null ? "?" : ok ? "✓" : "✗"} {label}
    </span>
  );
}

export async function SignalsFeed() {
  const latest = await prisma.signal.findFirst({
    orderBy: { date: "desc" },
    select: { date: true },
  });
  if (!latest) return null;

  const signals = await prisma.signal.findMany({
    where: { date: latest.date },
    include: { stock: true },
    orderBy: { type: "asc" },
  });
  if (signals.length === 0) return null;

  const parse = (s: string | null): Record<string, unknown> => {
    try {
      return s ? JSON.parse(s) : {};
    } catch {
      return {};
    }
  };
  const breakouts = signals.filter((s) => s.type === "pivot_breakout");
  const newSetups = signals.filter((s) => s.type === "vcp_new");
  const stopRaises = signals.filter((s) => s.type === "stop_raise");

  // Criteria per breakout: prefer the values frozen into the payload at
  // signal time; older signals predate that, so fall back to current data.
  const criteriaByCode = new Map<string, Criteria>();
  if (breakouts.length > 0) {
    const legacy = breakouts.filter((s) => {
      const p = parse(s.payload);
      return !("rs" in p);
    });
    if (legacy.length > 0) {
      const [univ, fins] = await Promise.all([
        prisma.momentum.findMany({ select: { code: true, rsRaw: true, technicalPass: true } }),
        prisma.financialCache.findMany({
          where: { code: { in: legacy.map((s) => s.code) } },
          orderBy: { fiscalYearEnd: "desc" },
          select: { code: true, fiscalYearEnd: true, salesYoY: true },
        }),
      ]);
      const ratings = computeRSRatings(univ);
      const ttByCode = new Map(univ.map((m) => [m.code, m.technicalPass]));
      const latestFin = new Map<string, { fiscalYearEnd: string; salesYoY: number | null }>();
      for (const f of fins) if (!latestFin.has(f.code)) latestFin.set(f.code, f);
      for (const s of legacy) {
        criteriaByCode.set(s.code, {
          rs: ratings.get(s.code) ?? null,
          tt: ttByCode.get(s.code) ?? null,
          salesYoY: latestFin.get(s.code)?.salesYoY ?? null,
          fy: latestFin.get(s.code)?.fiscalYearEnd ?? null,
          fromPayload: false,
        });
      }
    }
    for (const s of breakouts) {
      const p = parse(s.payload);
      if ("rs" in p) {
        criteriaByCode.set(s.code, {
          rs: (p.rs as number | null) ?? null,
          tt: (p.tt as boolean | null) ?? null,
          salesYoY: (p.salesYoY as number | null) ?? null,
          fy: (p.fy as string | null) ?? null,
          fromPayload: true,
        });
      }
    }
  }

  const passList = breakouts.filter((s) => {
    const c = criteriaByCode.get(s.code);
    return c && gatePass(c);
  });

  return (
    <section className="rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/60 dark:bg-indigo-950/20 p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-indigo-900 dark:text-indigo-300">
          📣 今日のシグナル
        </h2>
        <div className="flex items-center gap-3">
          <Link href="/signals" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
            📈 過去シグナルの成績 →
          </Link>
          <span className="text-xs text-neutral-500">
            {latest.date} 朝の自動スキャン(毎朝7時更新)
          </span>
        </div>
      </div>

      {breakouts.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            🚀 ピボット・ブレイクアウト({breakouts.length}件) — うち検証済み3基準クリアは{passList.length}件
          </div>
          <ul className="space-y-2">
            {breakouts.map((s) => {
              const p = parse(s.payload);
              const c = criteriaByCode.get(s.code);
              const pass = c ? gatePass(c) : false;
              const reasons: string[] = [];
              if (c) {
                if (!(c.rs != null && c.rs >= 70)) reasons.push("RS70未満");
                if (c.tt !== true) reasons.push("トレンド条件未達");
                if (!(c.salesYoY != null && c.salesYoY >= 10))
                  reasons.push(c.salesYoY == null ? "増収データなし" : "増収10%未満");
              }
              return (
                <li
                  key={s.id}
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    pass
                      ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30"
                      : "border-black/5 dark:border-white/5 bg-white/60 dark:bg-neutral-900/40"
                  }`}
                >
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <div>
                      <Link href={`/stocks/${s.code}`} className="font-medium hover:underline">
                        {s.stock.ticker} {s.stock.name}
                      </Link>{" "}
                      <span className="text-neutral-600 dark:text-neutral-400">
                        ¥{Math.round(Number(p.price ?? 0)).toLocaleString()} がピボット¥
                        {Math.round(Number(p.pivot ?? 0)).toLocaleString()} を上抜け(+
                        {Number(p.movePct ?? 0).toFixed(1)}%)
                      </span>
                    </div>
                    <span
                      className={`text-xs font-semibold ${
                        pass
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-neutral-500"
                      }`}
                    >
                      {pass ? "🔴 買い候補" : `⚪ ルール上見送り(${reasons.join("・")})`}
                    </span>
                  </div>
                  {c && (
                    <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                      <CriteriaBadge
                        ok={c.rs != null ? c.rs >= 70 : null}
                        label={`RS ${c.rs ?? "—"}`}
                      />
                      <CriteriaBadge ok={c.tt} label="トレンド型" />
                      <CriteriaBadge
                        ok={c.salesYoY != null ? c.salesYoY >= 10 : null}
                        label={`増収 ${
                          c.salesYoY != null
                            ? `${c.salesYoY >= 0 ? "+" : ""}${c.salesYoY.toFixed(1)}%`
                            : "—"
                        }${c.fy ? `(${c.fy.slice(0, 7)}期)` : ""}`}
                      />
                      {pass && (
                        <span className="text-[11px] text-neutral-500">
                          損切り目安: 買値-8% = ¥
                          {Math.round(Number(p.price ?? 0) * 0.92).toLocaleString()}
                        </span>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="text-[11px] text-amber-700 dark:text-amber-500">
            ⚠️ 増収YoYは約12週遅延の決算データです。🔴買い候補は発注前に必ず「最新の四半期決算(発表日・修正の有無)」と「次回決算発表日」を確認してください(発表5営業日前以内の新規買いは急変リスク)。
          </div>
        </div>
      )}

      {newSetups.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-indigo-700 dark:text-indigo-400">
            🧨 新規VCP形成({newSetups.length}件) — 監視リスト入り候補
          </div>
          <ul className="space-y-1">
            {newSetups.slice(0, 8).map((s) => {
              const p = parse(s.payload);
              return (
                <li key={s.id} className="text-sm">
                  <Link href={`/stocks/${s.code}`} className="font-medium hover:underline">
                    {s.stock.ticker} {s.stock.name}
                  </Link>{" "}
                  <span className="text-neutral-600 dark:text-neutral-400">
                    — ピボット¥{Math.round(Number(p.pivot ?? 0)).toLocaleString()}超え待ち
                  </span>
                </li>
              );
            })}
          </ul>
          {newSetups.length > 8 && (
            <Link href="/screener?vcp=1&sort=rs" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
              他{newSetups.length - 8}件をスクリーナーで見る →
            </Link>
          )}
        </div>
      )}

      {stopRaises.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-amber-700 dark:text-amber-400">
            ⬆ 損切り引き上げ提案({stopRaises.length}件) — 利益の保護
          </div>
          <ul className="space-y-1">
            {stopRaises.map((s) => {
              const p = parse(s.payload);
              return (
                <li key={s.id} className="text-sm">
                  <Link href={`/stocks/${s.code}`} className="font-medium hover:underline">
                    {s.stock.ticker} {s.stock.name}
                  </Link>{" "}
                  <span className="text-neutral-600 dark:text-neutral-400">
                    — 取得比+{Number(p.gainPct ?? 0).toFixed(1)}%。損切りを
                    {p.currentStop != null
                      ? `¥${Number(p.currentStop).toLocaleString()}→`
                      : ""}
                    ¥{Number(p.suggestedStop ?? 0).toLocaleString()}へ(
                    <Link href="/positions" className="underline">
                      ポジション管理で変更
                    </Link>
                    )
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {breakouts.length === 0 && newSetups.length === 0 && stopRaises.length === 0 && (
        <div className="text-sm text-neutral-500">本日のシグナルはありません。</div>
      )}

      <details className="text-xs text-neutral-600 dark:text-neutral-400">
        <summary className="cursor-pointer select-none text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300">
          📖 用語と判定基準の説明(初めての方はこちら)
        </summary>
        <div className="mt-2 space-y-1.5 pl-1">
          <p>
            <b>ピボット</b>: 直近10日の高値。ここを上抜けたら「買いの引き金」。もみ合いを上に抜けた瞬間が、統計的に最も失敗の少ないエントリー地点です。
          </p>
          <p>
            <b>VCP</b>: 値動きの振れ幅と出来高が徐々に縮む形。売り手が枯れて需給が買い側に傾いたサインで、ブレイクアウトの「準備完了」状態。
          </p>
          <p>
            <b>RS Rating</b>: 直近1年の株価の強さを全上場銘柄の中で1〜99位に順位付けしたもの。RS 87 = 上位13%。70以上が買い条件(全米チャンピオンMinerviniの基準)。
          </p>
          <p>
            <b>トレンド型(Trend Template)</b>: 移動平均線の並び・52週高値からの位置など7条件で「機関投資家が買い続けている上昇トレンドか」を判定。
          </p>
          <p>
            <b>増収10%ゲート</b>: 直近本決算の売上が前年比+10%以上。当サイトの10年バックテストでこの条件を足すと成績が大きく改善した(検証ページ参照)、株価上昇の燃料となるファンダメンタル条件。
          </p>
          <p>
            <b>🔴買い候補の意味</b>: 上の3基準をすべて満たした銘柄のみ。それ以外は⚪見送り——基準を緩めることは検証していない賭けになるため、しません。
          </p>
        </div>
      </details>
    </section>
  );
}
