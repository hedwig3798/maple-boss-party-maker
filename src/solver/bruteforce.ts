import { Character } from '../types';
import { Target } from './targets';
import { EPS, isBetter, stdevOf } from './solve';

/**
 * 검증용 완전탐색: 캐릭터마다 (미배정 | 기존 파티 | 새 파티)를 모두 시도한다.
 * 작은 입력(캐릭터 ~12개)에서만 사용.
 */
export function bruteForce(target: Target, characters: Character[]) {
  const eligible = characters.filter((c) => target.bosses.every((b) => typeof c.rates[b.id] === 'number'));
  const n = eligible.length;
  const label = new Array<number>(n).fill(-1);
  let best = { count: 0, stdev: 0, minSlack: 0, parties: [] as string[][] };

  const evaluate = (partyCount: number) => {
    const parties: Character[][] = Array.from({ length: partyCount }, () => []);
    label.forEach((l, i) => l >= 0 && parties[l].push(eligible[i]));
    const slacks: number[] = [];
    for (const p of parties) {
      if (p.length < target.minSize || p.length > target.maxSize) return;
      if (new Set(p.map((c) => c.playerId)).size !== p.length) return;
      const cds = p.map((c) => c.cooldown);
      if (Math.max(...cds) - Math.min(...cds) > target.cooldownThreshold + EPS) return;
      let slack = Infinity;
      for (const b of target.bosses) {
        const sum = p.reduce((a, c) => a + c.rates[b.id], 0);
        if (sum < b.threshold - EPS) return;
        slack = Math.min(slack, sum / b.threshold);
      }
      slacks.push(slack);
    }
    const cand = {
      count: partyCount,
      stdev: stdevOf(slacks),
      minSlack: slacks.length ? Math.min(...slacks) : 0,
      parties: parties.map((p) => p.map((c) => c.id).sort()),
    };
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
