import Link from "next/link";
import { prisma } from "@/lib/db";
import sim from "@/data/guard-sim.json";
import { DEFAULT_GUARD } from "@/lib/guard-core";
import { GUARD_START_CASH } from "@/lib/guard-account";

// v2「年間損失上限型」— tonight's order sheet, the live paper account, and the
// SBI-realistic simulation behind it (scripts/research/sim-guard.ts →
// src/data/guard-sim.json; pre-registered in PREREGISTRATION.md round 3).
export const dynamic = "force-dynamic";

const PREREG_URL = "https://github.com/kan22dh/stock-research/blob/master/scripts/research/PREREGISTRATION.md";
const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
const yen = (v: number) => `${Math.round(v).toLocaleString()}円`;

type SimRow = {
  label: string; cagr: number; maxDD: number; worstYear: number; negativeYears: number;
  orderDaysPerYear: number | null; avgCash: number | null; breachYears: string[];
  years: { year: number; ret: number; taxPaid: number; locked: boolean }[];
};

function Card({ title, children, tone = "plain", id }: { title: string; children: React.ReactNode; tone?: "plain" | "warn" | "info" | "go"; id?: string }) {
  const cls = {
    plain: "border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900",
    warn: "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30",
    info: "border-sky-200 dark:border-sky-900/60 bg-sky-50 dark:bg-sky-950/30",
    go: "border-emerald-300 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30",
  }[tone];
  return (
    <section id={id} className={`rounded-xl border p-5 space-y-3 ${cls}`}>
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function YearBar({ v, max }: { v: number; max: number }) {
  const w = Math.min(100, (Math.abs(v) / max) * 100);
  return (
    <div className="flex items-center gap-2 min-w-[140px]">
      <div className="relative h-2.5 flex-1 bg-neutral-100 dark:bg-neutral-800 rounded">
        <div
          className={`absolute top-0 h-2.5 rounded ${v >= 0 ? "bg-emerald-500 left-1/2" : "bg-red-500 right-1/2"}`}
          style={{ width: `${w / 2}%` }}
        />
        <div className="absolute left-1/2 top-[-2px] h-[14px] w-px bg-neutral-400" />
      </div>
      <span className={`tabular-nums text-xs w-14 text-right ${v >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{pct(v)}</span>
    </div>
  );
}

export default async function GuardPage() {
  const [equity, positions, pendingOrders, trades, lastOrders] = await Promise.all([
    prisma.guardEquity.findMany({ orderBy: { date: "asc" } }),
    prisma.guardPosition.findMany(),
    prisma.guardOrder.findMany({ where: { status: "pending" }, orderBy: [{ side: "desc" }, { id: "asc" }] }),
    prisma.guardTrade.findMany({ orderBy: { id: "desc" }, take: 40 }),
    prisma.guardOrder.findMany({ orderBy: { id: "desc" }, take: 1 }),
  ]);
  const codes = [...new Set([...positions.map((p) => p.code), ...pendingOrders.map((o) => o.code), ...trades.map((t) => t.code)])];
  const stocks = await prisma.listedStock.findMany({ where: { code: { in: codes } }, select: { code: true, ticker: true, name: true, momentum: { select: { price: true } } } });
  const info = new Map(stocks.map((s) => [s.code, s]));
  const last = equity.at(-1);
  const yearRows = last ? equity.filter((e) => e.date.slice(0, 4) === last.date.slice(0, 4)) : [];
  const yearStart = yearRows.length ? (await prisma.appSetting.findUnique({ where: { key: "guardYearStart" } }))?.value : null;
  const ytd = last && yearStart ? last.value / Number(yearStart) - 1 : null;
  const stockShare = last && last.value > 0 ? last.stockValue / last.value : 0;
  const cushion = last ? last.value - last.floor : 0;
  const orderDate = pendingOrders[0]?.createdDate ?? lastOrders[0]?.createdDate ?? null;

  const def = sim.default as SimRow;
  const raw = sim.raw18a as SimRow;
  const topix = sim.topix as SimRow;
  const fixed = sim.fixed as SimRow[];
  const grid = sim.grid as SimRow[];
  const headline: SimRow[] = [def, fixed[0], fixed[1], raw, topix];
  const maxAbs = Math.max(...[def, raw, topix].flatMap((r) => r.years.map((y) => Math.abs(y.ret))));

  return (
    <div className="space-y-6 max-w-5xl">
      <header className="pt-2 space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">🛡️ v2 年間損失上限型(仮想口座)</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          「1年で失ってよい上限」を先に決め、その範囲でだけ株を持つ運用です。SBI証券のS株(手数料0円・翌朝の始値で約定・1株単位)と特定口座の税金まで再現したシミュレーションと、それを毎日自動で動かす仮想口座(元手{yen(GUARD_START_CASH)}、2026-11-02開始)です。
        </p>
      </header>

      <Card title="結論(先に読んでください)" tone="warn">
        <ol className="list-decimal pl-5 space-y-1.5 text-sm">
          <li>
            <b>「1年の損失を約5%までに抑える」は実現できます</b>。2009〜2026年のシミュレーションで最悪の年は{pct(def.worstYear)}、大暴落の日(2011年震災・2020年コロナ・2024年8月5日)でも1日の損失は最大{pct(Math.min(...Object.values((sim.default as unknown as { gapRet: Record<string, number> }).gapRet)))}でした。
          </li>
          <li>
            ただし<b>「絶対に負けない年」にはなりません</b>。17年中{def.negativeYears}年は小さなマイナス(最大{pct(def.worstYear)})でした。現金の利息が0%なので、下限を「年初の100%」にすると株を1株も持てない、という構造上の限界です。
          </li>
          <li>
            代償は大きく、<b>税引後の年率は{pct(def.cagr)}</b>です(株を常に持つ同じ銘柄選びは{pct(raw.cagr)}、TOPIXは{pct(topix.cagr)})。さらに調べると、<b>この守りの効果は「株を13%しか持たない」のと同じ</b>でした(下の表)。守りの強さを決めているのは仕組みではなく<b>株の比率</b>です。どこを選ぶかは社長のご判断です(私は投資助言業者ではありません)。
          </li>
        </ol>
      </Card>

      <Card title={`今夜の発注指示${orderDate ? `(${orderDate} 終値で判定)` : ""}`} tone="go" id="orders">
        {pendingOrders.length === 0 ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">今夜の発注はありません。毎営業日17時台に自動で判定し、必要なときだけここに出ます。</p>
        ) : (
          <>
            <ul className="text-sm list-disc pl-5 space-y-1">
              <li>SBI証券で<b>S株・成行</b>、<b>14:00〜翌朝7:00</b>に発注 → 次の営業日の <b>9:00の前場始値</b>で約定します(この時間帯なら仮想口座と同じ約定。7:00を過ぎると後場の値段になりズレます)</li>
              <li>売りがあれば先に売り、その代金で買います。株数は仮想口座(元手60万円)の数です。実際の元手が違う場合は比率を合わせてください</li>
              <li>⚠ <b>S株の対象銘柄か発注前に確認</b>してください(東証の全銘柄がS株で買えるわけではありません)。手数料0円は「インターネットコース+電子交付」の設定が条件です</li>
            </ul>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-neutral-500 border-b border-black/10 dark:border-white/10">
                  <th className="px-2 py-1.5">売買</th><th className="px-2 py-1.5">銘柄</th><th className="px-2 py-1.5 text-right">株数</th><th className="px-2 py-1.5 text-right">参考価格(終値)</th><th className="px-2 py-1.5 text-right">概算金額</th><th className="px-2 py-1.5">理由</th>
                </tr></thead>
                <tbody className="divide-y divide-black/5 dark:divide-white/5">
                  {pendingOrders.map((o) => {
                    const s = info.get(o.code);
                    return (
                      <tr key={o.id}>
                        <td className={`px-2 py-1.5 font-semibold ${o.side === "buy" ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{o.side === "buy" ? "買い" : "売り"}</td>
                        <td className="px-2 py-1.5"><Link href={`/stocks/${o.code}`} className="hover:underline"><span className="font-mono text-neutral-500 mr-1.5">{s?.ticker ?? o.code.slice(0, 4)}</span>{s?.name ?? ""}</Link></td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{o.shares}株</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">¥{o.refPrice.toLocaleString()}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{yen(o.shares * o.refPrice)}</td>
                        <td className="px-2 py-1.5 text-xs text-neutral-500">{o.reason}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <Card title="仮想口座の現在地">
        {!last ? (
          <p className="text-sm text-neutral-500">まだ記録がありません。</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                ["評価額", yen(last.value), `${last.date} 終値`],
                ["今年の損益", pct(ytd), `下限まで あと${yen(cushion)}`],
                ["今年の下限(これ以下で全額現金)", yen(last.floor), `年初の${(100 - DEFAULT_GUARD.lossBudget * 100).toFixed(0)}% から上にだけ動く`],
                ["株の比率(現在 → 目標)", `${(stockShare * 100).toFixed(0)}% → ${(last.exposure * 100).toFixed(0)}%`, last.locked ? "下限到達: 年末まで現金" : `目標 = ${DEFAULT_GUARD.multiplier}×(評価額−下限)÷評価額`],
              ].map(([k, v, sub]) => (
                <div key={k} className="rounded-lg border border-black/10 dark:border-white/10 px-3 py-2">
                  <div className="text-xs text-neutral-500">{k}</div>
                  <div className="text-lg font-semibold tabular-nums">{v}</div>
                  <div className="text-[11px] text-neutral-500">{sub}</div>
                </div>
              ))}
            </div>
            {positions.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-neutral-500 border-b border-black/10 dark:border-white/10">
                    <th className="px-2 py-1.5">保有銘柄</th><th className="px-2 py-1.5 text-right">株数</th><th className="px-2 py-1.5 text-right">平均取得</th><th className="px-2 py-1.5 text-right">前日終値</th><th className="px-2 py-1.5 text-right">損益</th>
                  </tr></thead>
                  <tbody className="divide-y divide-black/5 dark:divide-white/5">
                    {positions.map((p) => {
                      const s = info.get(p.code);
                      const avg = p.costBasis / p.shares;
                      const px = s?.momentum?.price ?? null;
                      return (
                        <tr key={p.code}>
                          <td className="px-2 py-1.5"><span className="font-mono text-neutral-500 mr-1.5">{s?.ticker}</span>{s?.name}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{p.shares}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">¥{Math.round(avg).toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{px != null ? `¥${px.toLocaleString()}` : "—"}</td>
                          <td className={`px-2 py-1.5 text-right tabular-nums ${px != null && px >= avg ? "text-emerald-600" : "text-red-600"}`}>{px != null ? pct(px / avg - 1) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Card>

      <Card title="運用シミュレーション(2009-01〜2026-10、SBI S株・手数料0円・特定口座の税引後)">
        <p className="text-xs text-neutral-500">
          元手60万円・1株単位・夜に発注して翌朝の始値で約定・配当は20.315%源泉後に入金・売買益は年ごとに損益通算して20.315%課税。2026年は10月までの途中経過です。
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-neutral-500 border-b border-black/10 dark:border-white/10">
              <th className="px-2 py-1.5">運用方法</th><th className="px-2 py-1.5 text-right">税引後 年率</th><th className="px-2 py-1.5 text-right">最悪の年</th><th className="px-2 py-1.5 text-right">マイナスの年</th><th className="px-2 py-1.5 text-right">最大下落</th><th className="px-2 py-1.5 text-right">発注日/年</th>
            </tr></thead>
            <tbody className="divide-y divide-black/5 dark:divide-white/5">
              {headline.map((r, i) => (
                <tr key={r.label} className={i === 0 ? "bg-emerald-50/60 dark:bg-emerald-950/20 font-medium" : ""}>
                  <td className="px-2 py-1.5">{i === 0 ? "🛡️ v2 既定(L=5%・倍率4・TIPP)" : r.label}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{pct(r.cagr)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{pct(r.worstYear)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.negativeYears}/17年</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{pct(r.maxDD)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.orderDaysPerYear != null ? `${r.orderDaysPerYear.toFixed(0)}日` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-neutral-600 dark:text-neutral-400">
          「固定 株13%/20%」は、株の比率を常に一定に保ち残りを現金にする比較用です。v2既定とほぼ同じ守りと成績になり、<b>年間の損失の大きさは「株の比率 × 銘柄群の最悪の年」でほぼ決まる</b>ことを示しています。
        </p>

        <h3 className="text-sm font-semibold pt-2">年ごとの成績(税引後)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-neutral-500 border-b border-black/10 dark:border-white/10">
              <th className="px-2 py-1">年</th><th className="px-2 py-1">🛡️ v2既定</th><th className="px-2 py-1">同じ銘柄・株100%</th><th className="px-2 py-1">TOPIX</th>
            </tr></thead>
            <tbody>
              {def.years.map((y, k) => (
                <tr key={y.year}>
                  <td className="px-2 py-0.5 tabular-nums text-xs text-neutral-500">{y.year}{y.year === 2026 ? "*" : ""}</td>
                  <td className="px-2 py-0.5"><YearBar v={y.ret} max={maxAbs} /></td>
                  <td className="px-2 py-0.5"><YearBar v={raw.years[k]?.ret ?? 0} max={maxAbs} /></td>
                  <td className="px-2 py-0.5"><YearBar v={topix.years[k]?.ret ?? 0} max={maxAbs} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="損失の上限と成績のトレードオフ(全18通り・事前登録)">
        <p className="text-xs text-neutral-500">L=1年で失ってよい上限、倍率=余裕分の何倍を株にするか。CPPI=下限は年初に固定、TIPP=年内の最高値に合わせて下限を引き上げる(利益を守るが、株の比率が「倍率×L」以下に抑えられる)。</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-neutral-500 border-b border-black/10 dark:border-white/10">
              <th className="px-2 py-1.5">設定</th><th className="px-2 py-1.5 text-right">税引後 年率</th><th className="px-2 py-1.5 text-right">最悪の年</th><th className="px-2 py-1.5 text-right">マイナスの年</th><th className="px-2 py-1.5 text-right">平均現金比率</th><th className="px-2 py-1.5">上限超えの年</th>
            </tr></thead>
            <tbody className="divide-y divide-black/5 dark:divide-white/5">
              {[def, ...grid].sort((a, b) => b.cagr - a.cagr).map((r) => (
                <tr key={r.label} className={r === def ? "bg-emerald-50/60 dark:bg-emerald-950/20 font-medium" : ""}>
                  <td className="px-2 py-1 whitespace-nowrap">{r === def ? "L5 m4 TIPP(既定)" : r.label}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{pct(r.cagr)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{pct(r.worstYear)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{r.negativeYears}/17</td>
                  <td className="px-2 py-1 text-right tabular-nums">{r.avgCash != null ? `${(r.avgCash * 100).toFixed(0)}%` : "—"}</td>
                  <td className="px-2 py-1 text-xs text-neutral-500">{r.breachYears.length ? r.breachYears.join(" ") : "なし"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-neutral-500">
          感度: 元手300万円でも年率{pct((sim.sensitivity as SimRow[])[0].cagr)}、片道0.1%の手数料がかかっても{pct((sim.sensitivity as SimRow[])[1].cagr)}(手数料の影響は小さい)。
        </p>
      </Card>

      <Card title="仕組み(1日の流れ)" tone="info">
        <ol className="list-decimal pl-5 text-sm space-y-1">
          <li><b>毎営業日17時台</b>(15:30の大引け後)に自動実行。前日の発注をその日の朝の始値で約定させ、配当を入金し、終値で評価します</li>
          <li><b>下限</b> = 年初の評価額×95%。今年の最高値が上がると、最高値×95%まで引き上がります(下がることはありません)</li>
          <li><b>株の目標比率</b> = 4 ×(評価額 − 下限)÷ 評価額。現在の比率と10ポイント以上ずれたら、その夜に調整の発注を出します。評価額が下限に届いたら年末まで全額現金</li>
          <li><b>銘柄</b>: 毎月最初の営業日に、全約1,250銘柄から「株価の強さ」と「配当利回り」を半分ずつで順位付けし、上昇トレンドの形を満たす上位10銘柄を均等に保有</li>
          <li>年が明けたら前年の売買益に20.315%を課税して精算し、新しい下限を設定</li>
        </ol>
      </Card>

      <Card title="正直な注意点">
        <ul className="list-disc pl-5 text-sm space-y-1.5">
          <li><b>未使用の検証期間が残っていません</b>。2026年11月からのこの仮想口座が、唯一の「事前に知らない期間」での検証になります。</li>
          <li>データは現在上場している銘柄だけで作っています(倒産・上場廃止した銘柄がいない「生存バイアス」)。2009〜2017年の成績は実際より良く見えています。</li>
          <li>現金の利息は0%と置いています。配当は権利落ち日に入金としています(実際は2〜3ヶ月後)。損失の繰越控除(確定申告)は考慮していません。</li>
          <li>前の晩に終値で判定 → 翌朝の始値で約定するため、その間の値動き(一晩の急落)は防げません。大暴落の日でもシミュレーション上の1日の損失は最大2.1%でした。</li>
          <li>検証の計画と全結果は<a href={PREREG_URL} className="underline" target="_blank" rel="noopener noreferrer">事前登録の記録</a>に、実行前の日時つきで残っています。運用の全体像は<Link href="/strategy" className="underline">運用ロジックと根拠</Link>、従来の自動運用は<Link href="/paper" className="underline">v1</Link>です。</li>
        </ul>
      </Card>

      {trades.length > 0 && (
        <Card title="約定履歴(仮想口座)">
          <ul className="text-sm space-y-1">
            {trades.map((t) => (
              <li key={t.id} className="tabular-nums">
                <span className="text-neutral-500 text-xs mr-2">{t.date}</span>
                <span className={t.side === "buy" ? "text-emerald-700" : "text-red-600"}>{t.side === "buy" ? "買" : "売"}</span>{" "}
                {info.get(t.code)?.name ?? t.code} {t.shares}株 @¥{t.price.toLocaleString()}
                {t.realized != null && <span className="text-xs text-neutral-500 ml-2">実現損益 {yen(t.realized)}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
