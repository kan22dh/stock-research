// おーちゃん(尾崎邦明)式: セクター内で材料が出た(誰かが急騰した)のに、
// まだ反応していない出遅れ銘柄を検出する。CAN SLIM/Trend Templateの
// 「強い銘柄を買う」順張りとは逆方向の、補完的なロジック。

export type LaggardCandidate = {
  code: string;
  sector33Name: string;
  ownReturn1m: number;
  leaderReturn1m: number;
  gap: number; // leaderReturn1m - ownReturn1m
};

export function findSectorLaggards(
  rows: { code: string; sector33Name: string | null; return1m: number | null }[],
  opts: { leaderThreshold?: number; laggardThreshold?: number } = {},
): LaggardCandidate[] {
  const leaderThreshold = opts.leaderThreshold ?? 10; // % — someone in the group just popped
  const laggardThreshold = opts.laggardThreshold ?? 3; // % — this stock hasn't moved yet

  const bySector = new Map<string, { code: string; return1m: number }[]>();
  for (const r of rows) {
    if (!r.sector33Name || r.return1m == null) continue;
    if (!bySector.has(r.sector33Name)) bySector.set(r.sector33Name, []);
    bySector.get(r.sector33Name)!.push({ code: r.code, return1m: r.return1m });
  }

  const results: LaggardCandidate[] = [];
  for (const [sector, list] of bySector) {
    if (list.length < 2) continue;
    const leaderReturn1m = Math.max(...list.map((x) => x.return1m));
    if (leaderReturn1m < leaderThreshold) continue;
    for (const item of list) {
      if (item.return1m <= laggardThreshold && item.return1m < leaderReturn1m) {
        results.push({
          code: item.code,
          sector33Name: sector,
          ownReturn1m: item.return1m,
          leaderReturn1m,
          gap: leaderReturn1m - item.return1m,
        });
      }
    }
  }
  results.sort((a, b) => b.gap - a.gap);
  return results;
}
