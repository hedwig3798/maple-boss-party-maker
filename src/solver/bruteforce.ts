import { Character } from '../types';
import { Target } from './targets';
import { EPS, isBetter, Objective, outlierReason } from './solve';

/**
 * 검증용 완전탐색: 캐릭터마다 (미배정 | 기존 파티 | 새 파티)를 모두 시도한다.
 * 작은 입력(캐릭터 ~12개)에서만 사용.
 */
export function bruteForce(target: Target, characters: Character[]) {
  const eligible = characters.filter(
    (c) => target.bosses.every((b) => typeof c.rates[b.id] === 'number') && !outlierReason(target, c),
  );
  const n = eligible.length;
  const label = new Array<number>(n).fill(-1);
  let best: Objective & { count: number; parties: string[][] } = { sizeCounts: [], maxSpread: 0, sumSpread: 0, count: 0, parties: [] };

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
    const cand = { sizeCounts, maxSpread, sumSpread, count: partyCount, parties: parties.map((p) => p.map((c) => c.id).sort()) };
    if (isBetter(cand, best)) best = cand;
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
  return best;
}
