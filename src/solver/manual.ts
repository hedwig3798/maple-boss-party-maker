import { Character } from '../types';
import { bossKind } from '../bossFamily';
import { EPS, hasRate, TargetResult } from './solve';

/** 손으로 고친 파티의 현재 상태 */
export interface EvaluatedParty {
  memberIds: string[];
  /** 보스 순서대로 배율 합 (배율이 없는 캐릭터는 0으로 계산) */
  rateSums: number[];
  slack: number;
  /** 여유율이 가장 낮은 보스의 순서 */
  tightest: number;
  spread: number;
  cooldownMin: number;
  cooldownMax: number;
  warnings: string[];
}

const pct = (x: number) => `${Math.round(x * 10) / 10}%`;

/** 파티 하나의 배율 합·여유율·편차·쿨감과 규칙 위반을 다시 계산 */
export function evaluateParty(r: TargetResult, memberIds: string[], chars: Map<string, Character>): EvaluatedParty {
  const ms = memberIds.map((id) => chars.get(id)).filter((c): c is Character => !!c);
  const warnings: string[] = [];
  if (ms.length < r.minSize) warnings.push(`인원 부족 (${ms.length}/${r.minSize}명)`);
  if (ms.length > r.maxSize) warnings.push(`인원 초과 (${ms.length}/${r.maxSize}명)`);
  const byPlayer = new Map<string, number>();
  ms.forEach((c) => byPlayer.set(c.playerId, (byPlayer.get(c.playerId) ?? 0) + 1));
  if ([...byPlayer.values()].some((n) => n > 1)) warnings.push('같은 플레이어 캐릭터가 둘 이상');

  const rateSums = r.bossIds.map((b) => ms.reduce((a, c) => a + (hasRate(c, b) ? c.rates[b] : 0), 0));
  let slack = Infinity;
  let tightest = 0;
  let spread = 0;
  r.bossIds.forEach((b, k) => {
    const s = rateSums[k] / r.thresholds[k];
    if (s < slack - EPS) {
      slack = s;
      tightest = k;
    }
    const rates = ms.map((c) => (hasRate(c, b) ? c.rates[b] : 0));
    if (rates.length) spread = Math.max(spread, (Math.max(...rates) - Math.min(...rates)) / r.thresholds[k]);
    if (rateSums[k] < r.thresholds[k] - EPS) warnings.push(`${r.isGroup ? `${r.bossNames[k]} ` : ''}기준치 미달 (${pct(rateSums[k])}/${pct(r.thresholds[k])})`);
    const missing = ms.filter((c) => !hasRate(c, b));
    if (missing.length) warnings.push(`${r.isGroup ? `${r.bossNames[k]} ` : ''}배율 미입력: ${missing.map((c) => c.name).join(', ')}`);
  });
  const cds = ms.map((c) => c.cooldown);
  const cooldownMin = cds.length ? Math.min(...cds) : 0;
  const cooldownMax = cds.length ? Math.max(...cds) : 0;
  if (cooldownMax - cooldownMin > r.cooldownThreshold + EPS) warnings.push(`쿨감 범위 초과 (${cooldownMin}~${cooldownMax}초)`);
  return { memberIds, rateSums, slack: ms.length ? slack : 0, tightest, spread, cooldownMin, cooldownMax, warnings };
}

/** 파티 사이로 캐릭터를 옮긴다. to = -1이면 미배정, to = parties.length면 새 파티. 빈 파티는 지운다 */
export function moveMember(parties: string[][], charId: string, to: number): string[][] {
  const next = parties.map((p) => p.filter((id) => id !== charId));
  if (to >= 0 && to < parties.length) next[to].push(charId);
  else if (to === parties.length) next.push([charId]);
  return next.filter((p) => p.length > 0);
}

/**
 * 같은 보스의 여러 난이도(또는 그 보스가 들어간 그룹)에 동시에 들어간 캐릭터.
 * 결과 key → 캐릭터 id → 겹치는 다른 결과 이름
 */
export function crossDifficultyConflicts(results: TargetResult[], partiesOf: (r: TargetResult) => string[][]) {
  const families = results.map((r) => new Set(r.bossNames.map((n) => bossKind(n).family)));
  const members = results.map((r) => new Set(partiesOf(r).flat()));
  const out = new Map<string, Map<string, string[]>>();
  results.forEach((r, i) => {
    const m = new Map<string, string[]>();
    results.forEach((o, j) => {
      if (i === j || ![...families[i]].some((f) => families[j].has(f))) return;
      for (const id of members[i]) if (members[j].has(id)) m.set(id, [...(m.get(id) ?? []), o.name]);
    });
    out.set(r.key, m);
  });
  return out;
}
