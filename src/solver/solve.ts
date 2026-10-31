import { Character } from '../types';
import { Target } from './targets';

export type Reason =
  | 'NO_RATE'
  | 'SOLO'
  | 'TOO_WEAK'
  | 'NOT_ENOUGH_MEMBERS'
  | 'SAME_PLAYER'
  | 'COOLDOWN'
  | 'NO_COMBINATION'
  | 'EXCLUDED'
  | 'OTHER_DIFFICULTY';

export const REASON_LABEL: Record<Reason, string> = {
  NO_RATE: '배율 미입력',
  SOLO: '솔로 가능',
  TOO_WEAK: '배율 너무 낮음',
  NOT_ENOUGH_MEMBERS: '참여 가능 인원 부족',
  SAME_PLAYER: '같은 플레이어 충돌',
  COOLDOWN: '쿨감 범위 초과',
  NO_COMBINATION: '기준치를 채울 조합 없음',
  EXCLUDED: '최적화 결과 제외',
  OTHER_DIFFICULTY: '다른 난이도에 배정',
};

export interface PartyResult {
  memberIds: string[];
  /** target.bosses 순서대로 배율 합 */
  rateSums: number[];
  /** 여유율 (그룹이면 보스별 여유율 중 최솟값) */
  slack: number;
  /** 파티 안 배율 편차: (최고 배율 − 최저 배율) ÷ 기준치, 그룹이면 보스별 값 중 최댓값 */
  spread: number;
  cooldownMin: number;
  cooldownMax: number;
}

export interface TargetResult {
  key: string;
  name: string;
  isGroup: boolean;
  bossIds: string[];
  bossNames: string[];
  thresholds: number[];
  minSize: number;
  maxSize: number;
  cooldownThreshold: number;
  parties: PartyResult[];
  /** 파티 편차 중 최댓값 */
  maxSpread: number;
  /** 파티 편차의 합 */
  sumSpread: number;
  /** false면 시간 제한 등으로 최적이 보장되지 않음 */
  optimal: boolean;
  /** 파티 인원 구성이 최적임이 확정되었는가 (optimal이 false여도 true일 수 있음) */
  countOptimal: boolean;
  elapsedMs: number;
  candidateCount: number;
  unassigned: { characterId: string; reason: Reason }[];
  error?: string;
}

export const EPS = 1e-9;
const MAX_ELIGIBLE = 64;
const MAX_CANDIDATES = 3_000_000;

export interface Objective {
  /** sizeCounts[s] = s명 파티 수 */
  sizeCounts: number[];
  maxSpread: number;
  sumSpread: number;
}

/** (작은 파티부터 최대한 많이) → (파티 편차 최댓값 최소) → (편차 합 최소) 순으로 a가 b보다 나은가 */
export function isBetter(a: Objective, b: Objective): boolean {
  const len = Math.max(a.sizeCounts.length, b.sizeCounts.length);
  for (let s = 0; s < len; s++) {
    const x = a.sizeCounts[s] ?? 0;
    const y = b.sizeCounts[s] ?? 0;
    if (x !== y) return x > y;
  }
  if (a.maxSpread < b.maxSpread - EPS) return true;
  if (a.maxSpread > b.maxSpread + EPS) return false;
  return a.sumSpread < b.sumSpread - EPS;
}

export const hasRate = (c: Character, bossId: string) => {
  const r = c.rates[bossId];
  return typeof r === 'number' && Number.isFinite(r);
};

/** 기준값에서 과도하게 벗어난 캐릭터의 제외 사유. 그룹이면 보스 중 하나라도 벗어나면 제외 */
export function outlierReason(target: Target, c: Character): Reason | undefined {
  if (target.bosses.some((b) => c.rates[b.id] >= b.threshold - EPS)) return 'SOLO';
  if (target.bosses.some((b) => c.rates[b.id] < (b.threshold / target.maxSize) * target.weakRatio - EPS)) return 'TOO_WEAK';
  return undefined;
}

export function solveTarget(
  target: Target,
  characters: Character[],
  timeLimitMs: number,
  now: () => number = () => performance.now(),
): TargetResult {
  const t0 = now();
  const deadline = t0 + timeLimitMs;
  const B = target.bosses.length;
  const thr = target.bosses.map((b) => b.threshold);
  const minSize = target.minSize;
  const maxSize = target.maxSize;
  const cdThr = target.cooldownThreshold;

  const result: TargetResult = {
    key: target.key,
    name: target.name,
    isGroup: target.isGroup,
    bossIds: target.bosses.map((b) => b.id),
    bossNames: target.bosses.map((b) => b.name),
    thresholds: thr,
    minSize,
    maxSize,
    cooldownThreshold: cdThr,
    parties: [],
    maxSpread: 0,
    sumSpread: 0,
    optimal: true,
    countOptimal: true,
    elapsedMs: 0,
    candidateCount: 0,
    unassigned: [],
    error: target.error,
  };
  if (target.error) return result;

  const eligible: Character[] = [];
  for (const c of characters) {
    if (!target.bosses.every((b) => hasRate(c, b.id))) {
      result.unassigned.push({ characterId: c.id, reason: 'NO_RATE' });
      continue;
    }
    const out = outlierReason(target, c);
    if (out) result.unassigned.push({ characterId: c.id, reason: out });
    else eligible.push(c);
  }
  if (eligible.length > MAX_ELIGIBLE) {
    result.error = `참여 가능 캐릭터가 ${MAX_ELIGIBLE}개를 넘어 계산할 수 없습니다`;
    return result;
  }
  // 쿨감 오름차순 정렬: 파티의 쿨감 범위 = 마지막 멤버 - 첫 멤버
  eligible.sort((a, b) => a.cooldown - b.cooldown || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const n = eligible.length;
  const cd = eligible.map((c) => c.cooldown);
  const playerIndex = new Map<string, number>();
  const pl = eligible.map((c) => {
    if (!playerIndex.has(c.playerId)) playerIndex.set(c.playerId, playerIndex.size);
    return playerIndex.get(c.playerId)!;
  });
  const rate = new Float64Array(n * B);
  eligible.forEach((c, i) => target.bosses.forEach((b, k) => (rate[i * B + k] = c.rates[b.id])));

  // ---- 1. 조건을 만족하는 극소 파티 후보 나열 ----
  // 멤버 한 명을 빼도 조건을 만족하는 파티는, 그 멤버를 뺀 더 작은 파티가 항상 낫다 → 극소 파티만 보면 된다
  const cLo: number[] = [];
  const cHi: number[] = [];
  const cMembers: number[][] = [];
  const cSlack: number[] = [];
  const cSpread: number[] = [];
  const byLowest: number[][] = Array.from({ length: n }, () => []);
  const inAnyCandidate = new Uint8Array(n);
  let truncated = false;

  const members: number[] = [];
  const sums = new Float64Array(B);
  const usedPlayer = new Uint8Array(playerIndex.size);

  const record = () => {
    for (const m of members) inAnyCandidate[m] = 1;
    // 극소 파티: 어떤 멤버를 빼도 조건을 만족하지 못함 (배율이 0 이상이므로 한 명 제거만 보면 충분)
    if (members.length - 1 >= minSize) {
      for (const m of members) {
        let ok = true;
        for (let k = 0; k < B; k++) if (sums[k] - rate[m * B + k] < thr[k] - EPS) ok = false;
        if (ok) return;
      }
    }
    let lo = 0;
    let hi = 0;
    for (const m of members) {
      if (m < 32) lo |= 1 << m;
      else hi |= 1 << (m - 32);
    }
    let slack = Infinity;
    let spread = 0;
    for (let k = 0; k < B; k++) {
      slack = Math.min(slack, sums[k] / thr[k]);
      let rmin = Infinity;
      let rmax = -Infinity;
      for (const m of members) {
        rmin = Math.min(rmin, rate[m * B + k]);
        rmax = Math.max(rmax, rate[m * B + k]);
      }
      spread = Math.max(spread, (rmax - rmin) / thr[k]);
    }
    byLowest[members[0]].push(cMembers.length);
    cLo.push(lo);
    cHi.push(hi);
    cMembers.push(members.slice());
    cSlack.push(slack);
    cSpread.push(spread);
    if (cMembers.length >= MAX_CANDIDATES) truncated = true;
  };

  let enumSteps = 0;
  const enumerate = (from: number) => {
    if ((++enumSteps & 4095) === 0 && now() > deadline) truncated = true;
    if (truncated) return;
    const size = members.length;
    if (size >= minSize) {
      let ok = true;
      for (let k = 0; k < B; k++) if (sums[k] < thr[k] - EPS) ok = false;
      if (ok) record();
    }
    if (size === maxSize) return;
    for (let j = from; j < n; j++) {
      if (cd[j] - cd[members[0]] > cdThr + EPS) break;
      if (usedPlayer[pl[j]]) continue;
      members.push(j);
      usedPlayer[pl[j]] = 1;
      for (let k = 0; k < B; k++) sums[k] += rate[j * B + k];
      enumerate(j + 1);
      for (let k = 0; k < B; k++) sums[k] -= rate[j * B + k];
      usedPlayer[pl[j]] = 0;
      members.pop();
      if (truncated) return;
    }
  };
  for (let i = 0; i < n && !truncated; i++) {
    members.push(i);
    usedPlayer[pl[i]] = 1;
    for (let k = 0; k < B; k++) sums[k] = rate[i * B + k];
    enumerate(i + 1);
    usedPlayer[pl[i]] = 0;
    members.pop();
  }
  result.candidateCount = cMembers.length;
  const sizeOf = (ci: number) => cMembers[ci].length;
  for (const list of byLowest) list.sort((a, b) => sizeOf(a) - sizeOf(b) || cSpread[a] - cSpread[b]);
  let sMin = maxSize + 1;
  for (const ms of cMembers) sMin = Math.min(sMin, ms.length);

  // 인원 구성 점수: s명 파티 수를 (n+1)진법의 (maxSize−s)번째 자리에 둔다 → 작은 파티 수가 사전식으로 우선
  const W = n + 1;
  const weight: number[] = [];
  for (let s = 0; s <= maxSize; s++) weight[s] = W ** (maxSize - s);

  // ---- 공통 탐색 상태 ----
  let usedLo = 0;
  let usedHi = 0;
  const isUsed = (i: number) => (i < 32 ? (usedLo >>> i) & 1 : (usedHi >>> (i - 32)) & 1) === 1;
  const fits = (ci: number) => (cLo[ci] & usedLo) === 0 && (cHi[ci] & usedHi) === 0;
  const apply = (ci: number) => {
    usedLo ^= cLo[ci];
    usedHi ^= cHi[ci];
  };
  const remSums = new Float64Array(B);
  /** i번 이후 아직 쓰지 않은 캐릭터로 더 얻을 수 있는 인원 구성 점수 상한 */
  const bound = (i: number) => {
    let cnt = 0;
    remSums.fill(0);
    for (let j = i; j < n; j++) {
      if (isUsed(j)) continue;
      cnt++;
      for (let k = 0; k < B; k++) remSums[k] += rate[j * B + k];
    }
    // 파티마다 배율 합이 기준치 이상이어야 하므로 파티 수 ≤ 남은 배율 합 ÷ 기준치
    let cap = Infinity;
    for (let k = 0; k < B; k++) cap = Math.min(cap, Math.floor(remSums[k] / thr[k] + EPS));
    // 남은 인원을 가장 작은 크기부터 채우는 것이 사전식 최대
    let ub = 0;
    for (let s = sMin; s <= maxSize && cap > 0; s++) {
      const c = Math.min(Math.floor(cnt / s), cap);
      ub += c * weight[s];
      cnt -= c * s;
      cap -= c;
    }
    return ub;
  };
  let nodes = 0;
  let aborted = false;
  const tick = () => {
    if ((++nodes & 1023) === 0 && now() > deadline) aborted = true;
    return aborted;
  };

  // ---- 2. 인원 구성 최적화: 작은 파티부터 최대한 많이 ----
  const rootUB = bound(0);
  let bestScore = 0;
  let bestSet: number[] = [];
  const chosen: number[] = [];
  const dfs1 = (i: number, score: number) => {
    if (tick()) return;
    if (score > bestScore) {
      bestScore = score;
      bestSet = chosen.slice();
    }
    if (bestScore >= rootUB || i >= n) return;
    if (score + bound(i) <= bestScore) return;
    if (isUsed(i)) {
      dfs1(i + 1, score);
      return;
    }
    for (const ci of byLowest[i]) {
      if (!fits(ci)) continue;
      apply(ci);
      chosen.push(ci);
      dfs1(i + 1, score + weight[sizeOf(ci)]);
      chosen.pop();
      apply(ci);
      if (aborted || bestScore >= rootUB) return;
    }
    dfs1(i + 1, score); // i번 캐릭터는 이번 보스에서 빠짐
  };
  dfs1(0, 0);
  const aborted1 = aborted;

  // ---- 3. 인원 구성 고정, 파티 편차 최댓값 최소 → 편차 합 최소 ----
  const need = new Array<number>(maxSize + 1).fill(0);
  bestSet.forEach((ci) => need[sizeOf(ci)]++);
  const K = bestSet.length;
  let best = {
    set: bestSet,
    maxSpread: bestSet.reduce((a, ci) => Math.max(a, cSpread[ci]), 0),
    sumSpread: bestSet.reduce((a, ci) => a + cSpread[ci], 0),
  };
  if (K > 0 && !aborted1) {
    const have = new Array<number>(maxSize + 1).fill(0);
    /** 크기별 후보 편차 최솟값: 아직 못 채운 파티가 가질 수 있는 편차의 하한 */
    const minSpreadOf = new Array<number>(maxSize + 1).fill(Infinity);
    cMembers.forEach((ms, ci) => (minSpreadOf[ms.length] = Math.min(minSpreadOf[ms.length], cSpread[ci])));
    const dfs2 = (i: number, k: number, score: number, curMax: number, curSum: number) => {
      if (tick()) return;
      if (k === K) {
        if (curMax < best.maxSpread - EPS || (curMax <= best.maxSpread + EPS && curSum < best.sumSpread - EPS))
          best = { set: chosen.slice(), maxSpread: curMax, sumSpread: curSum };
        return;
      }
      if (i >= n) return;
      if (score + bound(i) < bestScore) return;
      let restMax = curMax;
      let restSum = curSum;
      for (let s = sMin; s <= maxSize; s++) {
        if (have[s] === need[s]) continue;
        restMax = Math.max(restMax, minSpreadOf[s]);
        restSum += (need[s] - have[s]) * minSpreadOf[s];
      }
      if (restMax > best.maxSpread + EPS) return;
      if (restMax >= best.maxSpread - EPS && restSum >= best.sumSpread - EPS) return;
      if (isUsed(i)) {
        dfs2(i + 1, k, score, curMax, curSum);
        return;
      }
      for (const ci of byLowest[i]) {
        const s = sizeOf(ci);
        const sp = cSpread[ci];
        if (have[s] === need[s] || !fits(ci)) continue;
        const nMax = Math.max(curMax, sp);
        const nSum = curSum + sp;
        // 편차 최댓값·합은 파티를 더할수록 줄지 않는다
        if (nMax > best.maxSpread + EPS) continue;
        if (nMax >= best.maxSpread - EPS && nSum >= best.sumSpread - EPS) continue;
        apply(ci);
        chosen.push(ci);
        have[s]++;
        dfs2(i + 1, k + 1, score + weight[s], nMax, nSum);
        have[s]--;
        chosen.pop();
        apply(ci);
        if (aborted) return;
      }
      dfs2(i + 1, k, score, curMax, curSum);
    };
    dfs2(0, 0, 0, 0, 0);
  }

  result.optimal = !truncated && !aborted;
  result.countOptimal = !truncated && !aborted1;

  // ---- 결과 정리 ----
  const assigned = new Uint8Array(n);
  result.parties = best.set
    .map((ci): PartyResult => {
      const ms = cMembers[ci];
      ms.forEach((m) => (assigned[m] = 1));
      return {
        memberIds: ms.map((m) => eligible[m].id),
        rateSums: target.bosses.map((_, k) => ms.reduce((a, m) => a + rate[m * B + k], 0)),
        slack: cSlack[ci],
        spread: cSpread[ci],
        cooldownMin: cd[ms[0]],
        cooldownMax: cd[ms[ms.length - 1]],
      };
    })
    .sort((a, b) => a.memberIds.length - b.memberIds.length || a.spread - b.spread);
  result.maxSpread = best.maxSpread;
  result.sumSpread = best.sumSpread;

  const distinctPlayers = playerIndex.size;
  for (let i = 0; i < n; i++) {
    if (assigned[i]) continue;
    let reason: Reason;
    if (n < minSize) reason = 'NOT_ENOUGH_MEMBERS';
    else if (distinctPlayers < minSize) reason = 'SAME_PLAYER';
    else if (!cooldownWindowOk(i)) reason = 'COOLDOWN';
    else if (!inAnyCandidate[i]) reason = 'NO_COMBINATION';
    else reason = 'EXCLUDED';
    result.unassigned.push({ characterId: eligible[i].id, reason });
  }
  result.elapsedMs = now() - t0;
  return result;

  /** i를 포함하고 쿨감 범위 안에 서로 다른 플레이어를 최소 인원만큼 모을 수 있는가 */
  function cooldownWindowOk(i: number): boolean {
    for (let s = 0; s < n; s++) {
      if (cd[s] < cd[i] - cdThr - EPS || cd[s] > cd[i]) continue;
      const ps = new Set<number>([pl[i]]);
      for (let j = 0; j < n; j++) if (cd[j] >= cd[s] - EPS && cd[j] <= cd[s] + cdThr + EPS) ps.add(pl[j]);
      if (ps.size >= minSize) return true;
    }
    return false;
  }
}
