import { Character } from '../types';
import { Target } from './targets';
import { EPS, isBetter, Objective, outlierReason, rankCompare } from './solve';

type Best = Objective & { count: number; parties: string[][] };

/**
 * 검증용 완전탐색: 캐릭터마다 (미배정 | 기존 파티 | 새 파티)를 모두 시도한다.
 * 작은 입력(캐릭터 ~12개)에서만 사용.
 * 배율 순위 규칙: 상위 k명(컷)마다, 그 안에서 순위대로 "넣고도 파티를 짤 수 있으면" 넣은 구성만 후보로 본다.
 */
export function bruteForce(target: Target, characters: Character[]) {
  const bossIds = target.bosses.map((b) => b.id);
  const eligible = characters.filter(
    (c) => target.bosses.every((b) => typeof c.rates[b.id] === 'number') && !outlierReason(target, c),
  );
  const n = eligible.length;
  const label = new Array<number>(n).fill(-1);
  const empty: Best = { sizeCounts: [], maxSpread: 0, sumSpread: 0, count: 0, parties: [] };
  /** 배정된 캐릭터 집합(비트) → 그 집합으로 만들 수 있는 가장 좋은 파티 구성 */
  const bestByMask = new Map<number, Best>([[0, empty]]);

  const evaluate = (partyCount: number) => {
    const parties: Character[][] = Array.from({ length: partyCount }, () => []);
    label.forEach((l, i) => l >= 0 && parties[l].push(eligible[i]));
    const sizeCounts = new Array<number>(target.maxSize + 1).fill(0);
    let maxSpread = 0;
    let sumSpread = 0;
    for (const p of parties) {
      if (p.length < target.minSize || p.length > target.maxSize) return;
      if (new Set(p.map((c) => c.playerId)).size !== p.length) return;
      const cds = p.map((c) => c.cooldown);
      if (Math.max(...cds) - Math.min(...cds) > target.cooldownThreshold + EPS) return;
      let spread = 0;
      for (const b of target.bosses) {
        const rs = p.map((c) => c.rates[b.id]);
        if (rs.reduce((a, r) => a + r, 0) < b.threshold - EPS) return;
        spread = Math.max(spread, (Math.max(...rs) - Math.min(...rs)) / b.threshold);
      }
      sizeCounts[p.length]++;
      maxSpread = Math.max(maxSpread, spread);
      sumSpread += spread;
    }
    const mask = label.reduce((m, l, i) => (l >= 0 ? m | (1 << i) : m), 0);
    const cand = { sizeCounts, maxSpread, sumSpread, count: partyCount, parties: parties.map((p) => p.map((c) => c.id).sort()) };
    const cur = bestByMask.get(mask);
    if (!cur || isBetter(cand, cur)) bestByMask.set(mask, cand);
  };

  const rec = (i: number, partyCount: number) => {
    if (i === n) {
      evaluate(partyCount);
      return;
    }
    for (let l = -1; l <= partyCount; l++) {
      label[i] = l;
      rec(i + 1, l === partyCount ? partyCount + 1 : partyCount);
    }
  };
  rec(0, 0);

  const order = eligible.map((_, i) => i).sort((a, b) => rankCompare(eligible[a], eligible[b], bossIds));
  const feasible = [...bestByMask.keys()];
  let best = empty;
  let top = 0;
  for (let k = 0; k < n; k++) {
    top |= 1 << order[k];
    // 상위 k+1명 안에서: 순위대로, 지금까지 정한 것 + 이 캐릭터를 넣은 구성이 하나라도 있으면 넣는다
    let decided = 0;
    let taken = 0;
    for (let j = 0; j <= k; j++) {
      const bit = 1 << order[j];
      decided |= bit;
      if (feasible.some((m) => (m & ~top) === 0 && (m & decided) === (taken | bit))) taken |= bit;
    }
    const cand = bestByMask.get(taken)!;
    if (isBetter(cand, best)) best = cand;
  }
  return best;
}
