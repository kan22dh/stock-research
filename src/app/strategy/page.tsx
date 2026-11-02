import Link from "next/link";
import { prisma } from "@/lib/db";
import { fetchFredSeries, latestValue } from "@/lib/fred";
import { WITHDRAWAL_THRESHOLDS } from "@/lib/withdrawal-rule";
import { BENCHMARK_CODE } from "@/lib/price-upsert";

// 運用ロジックと根拠 — one page that explains, in plain Japanese, what the
// automatic account does, what the evidence for it actually is, what the
// 2026-11 rebuild research tested and rejected, and what the owner's goal
// (10× in 10 years) requires arithmetically. Research numbers are fixed
// facts from scripts/research/PREREGISTRATION.md (git-timestamped); the live
// parts (paper account, macro context) are read per request.
export const dynamic = "force-dynamic";

const PREREG_URL =
  "https://github.com/kan22dh/stock-research/blob/master/scripts/research/PREREGISTRATION.md";

// Required annual return to grow `start` into `target` over `years` with a
// fixed monthly contribution (monthly compounding, bisection).
function requiredAnnual(start: number, target: number, years: number, monthly: number): number | null {
  const n = years * 12;
  const fv = (m: number) => start * (1 + m) ** n + (m === 0 ? monthly * n : (monthly * ((1 + m) ** n - 1)) / m);
  if (fv(0) >= target) return 0;
  let lo = 0, hi = 0.1; // monthly 0%..10%
  if (fv(hi) < target) return null;
  for (let k = 0; k < 80; k++) {
    const mid = (lo + hi) / 2;
    if (fv(mid) < target) lo = mid; else hi = mid;
  }
  return (1 + hi) ** 12 - 1;
}
function futureValue(start: number, years: number, monthly: number, annual: number): number {
  const m = (1 + annual) ** (1 / 12) - 1, n = years * 12;
  return start * (1 + m) ** n + (monthly * ((1 + m) ** n - 1)) / m;
}

const yen = (v: number) => `${Math.round(v / 10_000).toLocaleString()}万円`;
const pct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

function Card({ title, children, tone = "plain" }: { title: string; children: React.ReactNode; tone?: "plain" | "warn" | "info" }) {
  const cls =
    tone === "warn"
      ? "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30"
      : tone === "info"
        ? "border-sky-200 dark:border-sky-900/60 bg-sky-50 dark:bg-sky-950/30"
        : "border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900";
  return (
    <section className={`rounded-xl border p-5 space-y-3 ${cls}`}>
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-neutral-500 border-b border-black/10 dark:border-white/10">
            {head.map((h) => (
              <th key={h} className="px-2 py-1.5 font-medium whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-black/5 dark:divide-white/5">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={`px-2 py-1.5 ${j > 0 ? "tabular-nums whitespace-nowrap" : ""}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function macroContext() {
  const ids = ["IRSTCI01JPM156N", "IRLTLT01JPM156N", "DGS10", "DEXJPUS"] as const;
  const series = await Promise.all(ids.map((id) => fetchFredSeries(id, { sinceYears: 2 }).catch(() => null)));
  return series.map((s, k) => {
    if (!s) return { id: ids[k], label: ids[k], value: null as number | null, date: null as string | null, unit: "" };
    const v = latestValue(s);
    return { id: ids[k], label: s.label, value: v.value, date: v.date, unit: s.unit };
  });
}

export default async function StrategyPage() {
  const [firstEq, lastEq, b0, b1, macro] = await Promise.all([
    prisma.paperEquity.findFirst({ orderBy: { date: "asc" } }),
    prisma.paperEquity.findFirst({ orderBy: { date: "desc" } }),
    prisma.priceCache.findFirst({ where: { code: BENCHMARK_CODE, date: { lte: new Date("2026-07-24") } }, orderBy: { date: "desc" } }),
    prisma.priceCache.findFirst({ where: { code: BENCHMARK_CODE }, orderBy: { date: "desc" } }),
    macroContext(),
  ]);
  const START = 600_000;
  const liveRet = lastEq ? lastEq.equity / START - 1 : null;
  const benchRet = b0 && b1 ? (b1.adjClose ?? b1.close) / (b0.adjClose ?? b0.close) - 1 : null;

  // 10× arithmetic: 300万円 → 3,000万円 in 10 years.
  const P = 3_000_000, T = 30_000_000, Y = 10, TOPIX_LONG = 0.117;
  const contribs = [0, 30_000, 50_000, 100_000];

  return (
    <div className="space-y-6 max-w-4xl">
      <header className="pt-2 space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">🧭 運用ロジックと根拠</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          自動運用が何をしていて、その根拠がどこまで確かなのか。2026年11月の全面見直しで何を試し、何を採用しなかったのか。目標「10年で資産10倍」に何が必要か。を1ページにまとめています。
        </p>
      </header>

      <Card title="結論(3行)" tone="warn">
        <ol className="list-decimal pl-5 space-y-1.5 text-sm">
          <li>
            自動運用(v1)の中核ルール「株価の強さ上位10銘柄」は、<b>データを修復して測り直すと2017年以降TOPIX(指数そのもの)に勝てていません</b>(年+7.3% vs TOPIX +10.7%、2017-11〜2025-10)。以前の「年+18.7%」は、たまたま好調だった期間の切り取りと、壊れた株価データ(未調整の株式分割など)に押し上げられた数字でした。
          </li>
          <li>
            見直しで28通りのルールを事前登録のうえ検証し、最有力候補を未使用の直近12ヶ月で最終テストしましたが、<b>指数に確実に勝つルールは見つかりませんでした</b>。見つかった効果は「下落幅を半分にする」リスク低減だけです。
          </li>
          <li>
            10年で10倍は年+25.9%が必要です。TOPIX並み(年+12%前後)なら10年で約3倍。<b>差を埋める現実的な手段は「銘柄選びのルール」より「積立額」と「どこまでリスクを取るか」の選択</b>で、これは社長ご自身の判断事項です(私は投資助言業者ではなく、以下は計算と検証結果の提示です)。
          </li>
        </ol>
      </Card>

      <Card title="いま自動運用(v1・仮想60万円)がしていること">
        <ul className="list-disc pl-5 text-sm space-y-1.5">
          <li><b>毎月初</b>に、全約1,250銘柄から「直近1年の値上がりの強さ(RS)」が高い順に並べる</li>
          <li>そのうち<b>上昇トレンドの形(Trend Template:移動平均線の並びなど7条件)</b>を満たし、<b>直近決算の売上が前年比+10%以上</b>のものを上位10銘柄まで均等に買う</li>
          <li>翌月初まで持ち、圏外に落ちた銘柄を売って入れ替える(月中の損切りはしない。検証で逆効果だったため)</li>
        </ul>
        <div className="text-sm">
          実績(2026-07-25開始):{" "}
          <b className={liveRet != null && liveRet >= 0 ? "text-emerald-600" : "text-red-600"}>
            {liveRet != null ? pct(liveRet) : "—"}
          </b>{" "}
          / 同期間のTOPIX {benchRet != null ? pct(benchRet) : "—"}({lastEq?.date ?? "—"}時点)。
          ※8/12〜10/2は自動更新が止まっており、9月の入替は実行されていません(<Link href="/paper" className="underline">月次振り返り</Link>に欠損として表示)。
        </div>
      </Card>

      <Card title="根拠の数字(修復済みデータでの再計算)">
        <Table
          head={["期間", "v1中核ルール(上位10)", "TOPIX", "最大下落"]}
          rows={[
            ["2017-11〜2025-10(開発期間)", "+7.3%/年", "+10.7%/年", "−45.9%"],
            ["2017-11〜2026-06(旧「+18.7%」と同種の切り取り)", "+14.3%/年", "+12.3%/年", "−45.9%"],
            ["2017-11〜2026-10(今日まで)", "+9.2%/年", "+11.9%/年", "−45.9%"],
            ["2009-01〜2017-04(参考・生存バイアス大)", "+30.1%/年", "+11.2%/年", "−52.0%"],
          ]}
        />
        <p className="text-xs text-neutral-500">
          2009〜2017年の好成績は、今も上場している会社だけでデータを作っている(倒産・上場廃止した銘柄がいない)「生存バイアス」と、アベノミクス相場が最も効く期間です。直近8年はこのルールの優位性が消えています。
        </p>
      </Card>

      <Card title="2026年11月の全面見直しで検証したこと">
        <p className="text-sm">
          結果を見てから基準を変える「後出し」を防ぐため、候補と合格基準を<a href={PREREG_URL} className="underline" target="_blank" rel="noopener noreferrer">実行前にGitHubへ記録</a>してから検証しました(28通り+最終テスト1回)。
        </p>
        <Table
          head={["試したアイデア(出典)", "結果", "判定"]}
          rows={[
            ["指数が移動平均線より下なら全部現金(Faber 2007)", "売買の往復ビンタで成績悪化", "不採用"],
            ["値動きの荒さで割った強さで選ぶ", "下落は半分だが利益も減る", "不採用"],
            ["52週高値への近さで選ぶ(George & Hwang 2004)", "全期間で基準未満", "不採用"],
            ["強さ+長期の出遅れ(割安の代用)", "前半はデータ不足、後半は不安定", "不採用"],
            ["1業種あたりの上限(2/3/4銘柄)", "上限3だけ良く、2と4は悪い=偶然の可能性", "不採用"],
            ["銘柄数を15・20に増やす", "2017年以降は良いが2009〜17年は劣後", "不採用"],
            ["配当利回り(割安の代用)、強さ+配当の合成(Asness 2011)", "指数に全期間で勝つが、基準の2009〜17年でv1に届かず。最終テスト(直近12ヶ月)は+20.3%でTOPIX+21.5%に負け", "不採用"],
            ["日経レバ(1570)を指数のトレンドで売買", "年+13.9%・最大下落−47%。買い持ちに負ける。NISA対象外", "不採用"],
          ]}
        />
        <p className="text-xs text-neutral-500">
          唯一一貫して見えた効果は<b>リスク低減</b>です。強さに配当利回りを混ぜると最大下落が−52%→−26〜−37%に、銘柄数を20にすると−46%→−39%に縮みました。リターンを増やす効果ではないため、今回は採用していません。
        </p>
      </Card>

      <Card title="ルールに使わなかった情報とその理由">
        <ul className="list-disc pl-5 text-sm space-y-1.5">
          <li>
            <b>X・AIの成功談</b>:第三者の口座確認がなく、失敗者が見えない「生存者バイアス」の典型(<a className="underline" href="https://www.matsui.co.jp/fund/column/survivorship-bias/" target="_blank" rel="noopener noreferrer">松井証券</a>)。AIで運用するヘッジファンドの指数も、長期ではS&P500に負けています(<a className="underline" href="https://www.hedgeco.net/news/?p=58736" target="_blank" rel="noopener noreferrer">HedgeCo</a>)。
          </li>
          <li>
            <b>海外投資家の売買動向(投資部門別売買状況)</b>:売買シェアは6〜7割と大きいものの、「先を予測できる」と統計的に示した研究は見つかりませんでした。あるのは後付けの説明だけです。
          </li>
          <li>
            <b>金利・為替の水準</b>:下に参考表示していますが、売買ルールには使っていません。水準から相場を当てるルールで、検証に耐えたものがないためです(相場は予測せず、反応する方針)。
          </li>
          <li>
            <b>日本株でのモメンタム(強さ)の弱さ</b>は学術的にも知られています。日本では強さ単独のシャープレシオが0.03と他国の1/10程度ですが、割安と組み合わせると0.65に上がります(<a className="underline" href="https://www.cxoadvisory.com/momentum-investing/exclude-japan-from-momentum-portfolios/" target="_blank" rel="noopener noreferrer">Asness 2011 の要約</a>)。今回の結果と整合的です。
          </li>
        </ul>
      </Card>

      <Card title="10年で10倍(300万円→3,000万円)の算数" tone="info">
        <Table
          head={["毎月の積立", "10倍に必要な年利回り", "TOPIX並み(年+11.7%)なら10年後"]}
          rows={contribs.map((c) => {
            const r = requiredAnnual(P, T, Y, c);
            const fv = futureValue(P, Y, c, TOPIX_LONG);
            return [
              c === 0 ? "なし" : `${(c / 10_000).toLocaleString()}万円`,
              r == null ? "—" : r === 0 ? "積立だけで到達" : pct(r),
              `${yen(fv)}(${(fv / P).toFixed(1)}倍)`,
            ];
          })}
        />
        <p className="text-xs text-neutral-600 dark:text-neutral-400">
          月複利・税金と手数料は考慮していません。年+11.7%はTOPIXの2009〜2025年の実績で、将来を約束する数字ではありません。積立なしで10倍を狙うには年+25.9%が必要です。今回検証した中にこれを安定して出すルールはなく、出せるとすれば大きな集中投資や信用取引など、損失も大きくなる選択になります。
        </p>
      </Card>

      <Card title="マクロ環境(参考情報 — 売買ルールには使いません)">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {macro.map((m) => (
            <div key={m.id} className="rounded-lg border border-black/10 dark:border-white/10 px-3 py-2">
              <div className="text-xs text-neutral-500">{m.label}</div>
              <div className="text-lg font-semibold tabular-nums">
                {m.value != null ? `${m.value.toFixed(m.unit === "%" ? 2 : 1)}${m.unit === "%" ? "%" : ""}` : "—"}
              </div>
              <div className="text-[11px] text-neutral-500">{m.date ?? ""}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-neutral-500">
          出典: FRED(日本の金利はOECDの月次データで1〜2ヶ月遅れ)。日々の値は<Link href="/macro" className="underline">マクロ</Link>ページへ。
        </p>
      </Card>

      <Card title="撤退ルール(見直し後)">
        <p className="text-sm">
          自動運用の成績が、このルール自身の過去17年の最悪記録を超えたら警告を出します(自動で売却はしません)。最悪記録は修復済みデータで測り直しました。
        </p>
        <Table
          head={["指標", "過去最悪(2009〜2026)", "警告ライン"]}
          rows={[
            ["最大下落", "−52.0%", `${WITHDRAWAL_THRESHOLDS.maxDrawdownPct}%`],
            ["12ヶ月のTOPIX比", "−42.8pt", `${WITHDRAWAL_THRESHOLDS.rolling12mExcessPct}pt`],
            ["24ヶ月のTOPIX比", "−50.4pt", `${WITHDRAWAL_THRESHOLDS.rolling24mExcessPct}pt`],
          ]}
        />
      </Card>

      <Card title="データ品質について(今回直したこと)">
        <ul className="list-disc pl-5 text-sm space-y-1.5">
          <li>
            毎朝の自動更新が<b>8/12〜10/2の7週間止まっていました</b>。加えてTOPIXの価格が7/24から、ほとんどの銘柄の価格履歴が7月から更新されていませんでした。どちらも修正済みです。毎朝8:30にGitHubが<a href="/api/health" className="underline">健康状態</a>を確認し、異常なら1回自動で再実行、それでも直らなければメールで知らせます(費用ゼロ)。
          </li>
          <li>
            Yahooの長期株価に、<b>1日で±40%を超える「ありえない」値動き</b>(未調整の株式分割、上場廃止と再上場の継ぎはぎなど)が約5%の銘柄で見つかりました。その前の履歴は使わないよう修正しています。
          </li>
        </ul>
      </Card>
    </div>
  );
}
