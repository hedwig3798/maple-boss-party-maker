import { Character } from '../types';
import { Target } from './targets';

export type Reason =
  | 'NO_RATE'
  | 'NOT_ENOUGH_MEMBERS'
  | 'SAME_PLAYER'
  | 'COOLDOWN'
  | 'NO_COMBINATION'
  | 'EXCLUDED';

export const REASON_LABEL: Record<Reason, string> = {
  NO_RATE: '배율 미입력',
  NOT_ENOUGH_MEMBERS: '참여 가능 인원 부족',
  SAME_PLAYER: '같은 플레이어 충돌',
  COOLDOWN: '쿨감 범위 초과',
  NO_COMBINATION: '기준치를 채울 조합 없음',
  EXCLUDED: '최적화 결과 제외',
};

export interface PartyResult {
  memberIds: string[];
  /** target.bosses 순서대로 배율 합 */
  rateSums: number[];
  /** 여유율 (그룹이면 보스별 여유율 중 최솟값) */
  slack: number;
  cooldownMin: number;
  cooldownMax: number;
}

export interface TargetResult {
  key: string;
  name: string;
  isGroup: boolean;
  bossNames: string[];
  thresholds: number[];
  minSize: number;
  maxSize: number;
  cooldownThreshold: number;
  parties: PartyResult[];
  /** 파티 여유율의 모집단 표준편차 */
  stdev: number;
  minSlack: number;
  /** false면 시간 제한 등으로 최적이 보장되지 않음 */
  optimal: boolean;
  /** 파티 수가 최대임이 확정되었는가 (optimal이 false여도 true일 수 있음) */
  countOptimal: boolean;
  elapsedMs: number;
  candidateCount: number;
  unassigned: { characterId: string; reason: Reason }[];
  error?: string;
}

export const EPS = 1e-9;
const MAX_ELIGIBLE = 64;
const MAX_CANDIDATES = 3_000_000;

export function stdevOf(xs: number[]): number {
  if (xs.length === 0) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, x) => a + (x - mean) * (x - mean), 0) / xs.length;
  return Math.sqrt(v);
}

/** (파티 수 최대) → (표준편차 최소) → (최저 여유율 최대) 순으로 a가 b보다 나은가 */
export function isBetter(
  a: { count: number; stdev: number; minSlack: number },
  b: { count: number; stdev: number; minSlack: number },
): boolean {
  if (a.count !== b.count) return a.count > b.count;
  if (a.stdev < b.stdev - EPS) return true;
  if (a.stdev > b.stdev + EPS) return false;
  return a.minSlack > b.minSlack + EPS;
}

const hasRate = (c: Character, bossId: string) => {
  const r = c.rates[bossId];
  return typeof r === 'number' && Number.isFinite(r);
};

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
    bossNames: target.bosses.map((b) => b.name),
    thresholds: thr,
    minSize,
    maxSize,
    cooldownThreshold: cdThr,
    parties: [],
    stdev: 0,
    minSlack: 0,
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
    if (target.bosses.every((b) => hasRate(c, b.id))) eligible.push(c);
    else result.unassigned.push({ characterId: c.id, reason: 'NO_RATE' });
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

  // ---- 1. 조건을 만족하는 모든 파티 후보 나열 ----
  const cLo: number[] = [];
  const cHi: number[] = [];
  const cMembers: number[][] = [];
  const cSlack: number[] = [];
  const byLowestAll: number[][] = Array.from({ length: n }, () => []);
  const byLowestMinimal: number[][] = Array.from({ length: n }, () => []);
  const inAnyCandidate = new Uint8Array(n);
  let truncated = false;

  const members: number[] = [];
  const sums = new Float64Array(B);
  const usedPlayer = new Uint8Array(playerIndex.size);

  const record = () => {
    let lo = 0;
    let hi = 0;
    for (const m of members) {
      if (m < 32) lo |= 1 << m;
      else hi |= 1 << (m - 32);
      inAnyCandidate[m] = 1;
    }
    let slack = Infinity;
    for (let k = 0; k < B; k++) slack = Math.min(slack, sums[k] / thr[k]);
    // 극소 파티: 어떤 멤버를 빼도 조건을 만족하지 못함 (배율이 0 이상이므로 한 명 제거만 보면 충분)
    let minimal = true;
    if (members.length - 1 >= minSize) {
      for (const m of members) {
        let ok = true;
        for (let k = 0; k < B; k++) if (sums[k] - rate[m * B + k] < thr[k] - EPS) ok = false;
        if (ok) {
          minimal = false;
          break;
        }
      }
    }
    const idx = cMembers.length;
    cLo.push(lo);
    cHi.push(hi);
    cMembers.push(members.slice());
    cSlack.push(slack);
    byLowestAll[members[0]].push(idx);
    if (minimal) byLowestMinimal[members[0]].push(idx);
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
  for (const list of byLowestAll) list.sort((a, b) => cSlack[a] - cSlack[b]);
  for (const list of byLowestMinimal)
    list.sort((a, b) => cMembers[a].length - cMembers[b].length || cSlack[a] - cSlack[b]);

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
  /** i번 이후 아직 쓰지 않은 캐릭터로 만들 수 있는 파티 수 상한 (각 파티 여유율 ≥ minSlack) */
  const bound = (i: number, minSlack = 1) => {
    let cnt = 0;
    remSums.fill(0);
    for (let j = i; j < n; j++) {
      if (isUsed(j)) continue;
      cnt++;
      for (let k = 0; k < B; k++) remSums[k] += rate[j * B + k];
    }
    let ub = Math.floor(cnt / minSize);
    for (let k = 0; k < B; k++) ub = Math.min(ub, Math.floor(remSums[k] / (thr[k] * minSlack) + EPS));
    return ub;
  };
  let nodes = 0;
  let aborted = false;
  const tick = () => {
    if ((++nodes & 1023) === 0 && now() > deadline) aborted = true;
    return aborted;
  };

  // ---- 2. 파티 수 최대화 (극소 파티만으로 충분) ----
  const rootUB = bound(0);
  let bestK = 0;
  let bestSet: number[] = [];
  const chosen: number[] = [];
  const dfs1 = (i: number, k: number) => {
    if (tick()) return;
    if (k > bestK) {
      bestK = k;
      bestSet = chosen.slice();
    }
    if (bestK >= rootUB || i >= n) return;
    if (k + bound(i) <= bestK) return;
    if (isUsed(i)) {
      dfs1(i + 1, k);
      return;
    }
    for (const ci of byLowestMinimal[i]) {
      if (!fits(ci)) continue;
      apply(ci);
      chosen.push(ci);
      dfs1(i + 1, k + 1);
      chosen.pop();
      apply(ci);
      if (aborted || bestK >= rootUB) return;
    }
    dfs1(i + 1, k); // i번 캐릭터는 이번 보스에서 빠짐
  };
  dfs1(0, 0);
  const aborted1 = aborted;

  // ---- 3. 파티 수 K 고정, 여유율 표준편차 최소 → 최저 여유율 최대 ----
  const K = bestK;
  let best = { set: bestSet, count: K, stdev: stdevOf(bestSet.map((c) => cSlack[c])), minSlack: 0 };
  best.minSlack = K ? Math.min(...bestSet.map((c) => cSlack[c])) : 0;
  if (K > 0 && !aborted1 && !truncated) {
    const ls = localSearch(bestSet.map((c) => cMembers[c]), Math.min(deadline, now() + timeLimitMs * 0.2));
    if (isBetter(ls, best)) best = ls;
  }
  if (K > 0 && !aborted1) {
    // 현재 해의 평균 여유율에 가까운 파티부터 시도
    const mu = bestSet.reduce((a, c) => a + cSlack[c], 0) / K;
    for (const list of byLowestAll) list.sort((a, b) => Math.abs(cSlack[a] - mu) - Math.abs(cSlack[b] - mu));
    const sqrt2K = Math.sqrt(2 * K);
    let sum = 0;
    let sumSq = 0;
    const dfs2 = (i: number, k: number, curMin: number, curMax: number) => {
      if (tick()) return;
      if (k === K) {
        const slacks = chosen.map((c) => cSlack[c]);
        const cand = { set: chosen.slice(), count: K, stdev: stdevOf(slacks), minSlack: curMin };
        if (isBetter(cand, best)) best = cand;
        return;
      }
      if (i >= n) return;
      // K개 값의 범위가 R이면 표준편차 ≥ R/√(2K) → 더 나은 해의 여유율은 폭 rMax 안에 있다
      const rMax = best.stdev * sqrt2K + 1e-7;
      const lo = k > 0 ? curMax - rMax : -Infinity;
      const hi = k > 0 ? curMin + rMax : Infinity;
      if (k + bound(i, Math.max(1, lo)) < K) return;
      if (k >= 1) {
        // 이미 고른 여유율들의 제곱편차합은 최종 K개의 제곱편차합 이하
        const lb = Math.sqrt(Math.max(0, sumSq - (sum * sum) / k) / K);
        if (lb > best.stdev + EPS) return;
        if (lb >= best.stdev - EPS && curMin <= best.minSlack + EPS) return;
      }
      if (isUsed(i)) {
        dfs2(i + 1, k, curMin, curMax);
        return;
      }
      for (const ci of byLowestAll[i]) {
        const s = cSlack[ci];
        if (s < lo || s > hi || !fits(ci)) continue;
        apply(ci);
        chosen.push(ci);
        sum += s;
        sumSq += s * s;
        dfs2(i + 1, k + 1, Math.min(curMin, s), Math.max(curMax, s));
        sum -= s;
        sumSq -= s * s;
        chosen.pop();
        apply(ci);
        if (aborted) return;
      }
      dfs2(i + 1, k, curMin, curMax);
    };
    dfs2(0, 0, Infinity, -Infinity);
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
        cooldownMin: cd[ms[0]],
        cooldownMax: cd[ms[ms.length - 1]],
      };
    })
    .sort((a, b) => b.slack - a.slack);
  result.stdev = best.stdev;
  result.minSlack = best.minSlack;

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

  /** 파티의 여유율, 조건을 어기면 -1 */
  function partySlack(ms: number[]): number {
    if (ms.length < minSize || ms.length > maxSize) return -1;
    let cmin = Infinity;
    let cmax = -Infinity;
    for (let a = 0; a < ms.length; a++) {
      cmin = Math.min(cmin, cd[ms[a]]);
      cmax = Math.max(cmax, cd[ms[a]]);
      for (let b = 0; b < a; b++) if (pl[ms[a]] === pl[ms[b]]) return -1;
    }
    if (cmax - cmin > cdThr + EPS) return -1;
    let slack = Infinity;
    for (let k = 0; k < B; k++) {
      let s = 0;
      for (const m of ms) s += rate[m * B + k];
      if (s < thr[k] - EPS) return -1;
      slack = Math.min(slack, s / thr[k]);
    }
    return slack;
  }

  /**
   * 파티 수를 유지한 채 멤버 이동/교환으로 (표준편차, 최저 여유율)을 개선하는 국소 탐색.
   * 정확 탐색 전에 좋은 기준 해를 얻어 가지치기를 강하게 만드는 용도.
   */
  function localSearch(start: number[][], until: number) {
    const K = start.length;
    // 0..K-1: 파티, K: 미배정 풀
    let cont = [...start.map((p) => p.slice()), eligible.map((_, i) => i).filter((i) => !start.some((p) => p.includes(i)))];
    let slacks = cont.slice(0, K).map(partySlack);
    const objOf = (ss: number[]) => ({ count: K, stdev: stdevOf(ss), minSlack: Math.min(...ss) });
    let cur = objOf(slacks);
    let bestCont = cont.map((c) => c.slice());
    let bestObj = cur;
    let seed = 12345;
    const rnd = (m: number) => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed % m;
    };

    /** a의 xi번째를 b로 옮기고, yi ≥ 0이면 b의 yi번째를 a로 옮긴다 */
    const attempt = (a: number, xi: number, b: number, yi: number, needImprove: boolean) => {
      const na = cont[a].filter((_, i) => i !== xi);
      const nb = cont[b].filter((_, i) => i !== yi);
      nb.push(cont[a][xi]);
      if (yi >= 0) na.push(cont[b][yi]);
      const ss = slacks.slice();
      if (a < K && (ss[a] = partySlack(na)) < 0) return false;
      if (b < K && (ss[b] = partySlack(nb)) < 0) return false;
      const o = objOf(ss);
      if (needImprove && !isBetter(o, cur)) return false;
      cont[a] = na;
      cont[b] = nb;
      slacks = ss;
      cur = o;
      return true;
    };
    const improveOnce = () => {
      for (let a = 0; a <= K; a++)
        for (let xi = 0; xi < cont[a].length; xi++)
          for (let b = 0; b <= K; b++) {
            if (a === b) continue;
            if (attempt(a, xi, b, -1, true)) return true;
            if (a < b) for (let yi = 0; yi < cont[b].length; yi++) if (attempt(a, xi, b, yi, true)) return true;
          }
      return false;
    };

    for (let round = 0; round < 500 && now() < until; round++) {
      while (now() < until && improveOnce());
      if (isBetter(cur, bestObj)) {
        bestObj = cur;
        bestCont = cont.map((c) => c.slice());
      } else {
        cont = bestCont.map((c) => c.slice());
        slacks = cont.slice(0, K).map(partySlack);
        cur = bestObj;
      }
      // 무작위 섞기 후 다시 개선
      for (let kick = 0, tries = 0; kick < 3 && tries < 100; tries++) {
        const a = rnd(K + 1);
        const b = rnd(K + 1);
        if (a === b || cont[a].length === 0) continue;
        const yi = cont[b].length > 0 && rnd(2) ? rnd(cont[b].length) : -1;
        if (attempt(a, rnd(cont[a].length), b, yi, false)) kick++;
      }
    }

    // 후보 인덱스로 변환
    const index = new Map<string, number>();
    cMembers.forEach((ms, ci) => index.set(ms.join(','), ci));
    const set = bestCont.slice(0, K).map((ms) => index.get([...ms].sort((x, y) => x - y).join(','))!);
    return { set, ...bestObj };
  }

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
