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
  | 'RANK_BLOCKED'
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
  RANK_BLOCKED: '윗순위와 함께 넣을 조합 없음',
  EXCLUDED: '하위 배율이라 제외',
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
  elapsedMs: number;
  unassigned: { characterId: string; reason: Reason }[];
  error?: string;
}

export const EPS = 1e-9;
const MAX_ELIGIBLE = 64;

export interface Objective {
  /** sizeCounts[s] = s명 파티 수 */
  sizeCounts: number[];
  maxSpread: number;
  sumSpread: number;
}

/** (파티 수 최대) → (작은 파티부터 최대한 많이) → (파티 편차 최댓값 최소) → (편차 합 최소) 순으로 a가 b보다 나은가 */
export function isBetter(a: Objective, b: Objective): boolean {
  const count = (o: Objective) => o.sizeCounts.reduce((x, y) => x + y, 0);
  if (count(a) !== count(b)) return count(a) > count(b);
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

/** 순위를 매기는 배율: 보스(그룹이면 보스들) 배율의 단순 평균 */
export const averageRate = (c: Character, bossIds: string[]) =>
  bossIds.reduce((a, b) => a + (hasRate(c, b) ? c.rates[b] : 0), 0) / Math.max(1, bossIds.length);

/** 배율 순위: 평균 배율 높은 순, 같으면 id 순 */
export function rankCompare(a: Character, b: Character, bossIds: string[]): number {
  return averageRate(b, bossIds) - averageRate(a, bossIds) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** 기준값에서 과도하게 벗어난 캐릭터의 제외 사유. 그룹이면 보스 중 하나라도 벗어나면 제외 */
export function outlierReason(target: Target, c: Character): Reason | undefined {
  if (target.bosses.some((b) => c.rates[b.id] >= b.threshold - EPS)) return 'SOLO';
  if (target.bosses.some((b) => c.rates[b.id] < (b.threshold / target.maxSize) * target.weakRatio - EPS)) return 'TOO_WEAK';
  return undefined;
}

/**
 * 파티 계산.
 * 0순위: 배율 순위. 배율 평균 상위 k명만 데려간다고 정하고(컷), 그 안에서 순위대로 넣을 수 있으면 넣는다.
 *   넣을 수 없는(윗순위를 다 넣으면 파티를 못 짜는) 캐릭터만 건너뛴다 → 낮은 배율이 가고 높은 배율이 남는 일은
 *   높은 배율이 정말 들어갈 수 없을 때뿐이다.
 * 컷마다 구한 구성 중 ① 파티 수 최대 ② 작은 파티부터 최대한 많이 ③ 편차 최댓값 최소 ④ 편차 합 최소인 것을 고른다.
 */
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
  const bossIds = target.bosses.map((b) => b.id);

  const result: TargetResult = {
    key: target.key,
    name: target.name,
    isGroup: target.isGroup,
    bossIds,
    bossNames: target.bosses.map((b) => b.name),
    thresholds: thr,
    minSize,
    maxSize,
    cooldownThreshold: cdThr,
    parties: [],
    maxSpread: 0,
    sumSpread: 0,
    optimal: true,
    elapsedMs: 0,
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
  const P = playerIndex.size;
  const rate = new Float64Array(n * B);
  eligible.forEach((c, i) => target.bosses.forEach((b, k) => (rate[i * B + k] = c.rates[b.id])));
  const rankOrder = eligible.map((_, i) => i).sort((a, b) => rankCompare(eligible[a], eligible[b], bossIds));
  const rankPos = new Array<number>(n);
  rankOrder.forEach((i, pos) => (rankPos[i] = pos));

  // 인원 구성 점수: s명 파티 하나 = (n+1)^(maxSize+1) + (n+1)^(maxSize−s)
  // → 파티 수가 먼저, 같으면 작은 파티 수가 사전식으로 많은 쪽이 크다
  const W = n + 1;
  const PARTY = W ** (maxSize + 1);
  const weight: number[] = [];
  for (let s = 0; s <= maxSize; s++) weight[s] = PARTY + W ** (maxSize - s);

  let sliceEnd = deadline;
  let nodes = 0;
  let aborted = false;
  const tick = () => {
    if ((++nodes & 1023) === 0 && now() > sliceEnd) aborted = true;
    return aborted;
  };

  // ---- 탐색 상태 ----
  /** 0: 넣지 않음, 1: 반드시 넣음, 2: 넣어도 되고 빼도 됨 */
  const mark = new Uint8Array(n);
  const used = new Uint8Array(n);
  const reqPerPlayer = new Int32Array(P);
  /** 아직 처리하지 않은 (반드시·선택) 캐릭터의 배율 합과 수, 그중 반드시 넣을 캐릭터 수 */
  const avail = new Float64Array(B);
  let availLeft = 0;
  let reqLeft = 0;

  const prepare = () => {
    used.fill(0);
    reqPerPlayer.fill(0);
    avail.fill(0);
    availLeft = 0;
    reqLeft = 0;
    for (let i = 0; i < n; i++) {
      if (!mark[i]) continue;
      availLeft++;
      for (let k = 0; k < B; k++) avail[k] += rate[i * B + k];
      if (mark[i] === 1) {
        reqLeft++;
        reqPerPlayer[pl[i]]++;
      }
    }
  };
  /** i를 처리함(파티에 넣거나 뺌)으로 표시 / 되돌림 */
  const setUsed = (i: number, on: boolean) => {
    const d = on ? -1 : 1;
    used[i] = on ? 1 : 0;
    availLeft += d;
    for (let k = 0; k < B; k++) avail[k] += d * rate[i * B + k];
    if (mark[i] === 1) {
      reqLeft += d;
      reqPerPlayer[pl[i]] += d;
    }
  };
  /** cnt명, 파티 수 상한 cap으로 얻을 수 있는 인원 구성 점수 상한: 가장 작은 크기부터 채우는 것이 사전식 최대 */
  const fillBound = (cnt: number, cap: number) => {
    // 파티 수 상한과 작은 파티 점수 상한을 따로 구해 더한다
    let ub = Math.min(cap, Math.floor(cnt / minSize)) * PARTY;
    for (let s = minSize; s <= maxSize && cap > 0; s++) {
      const c = Math.min(Math.floor(cnt / s), cap);
      ub += c * (weight[s] - PARTY);
      cnt -= c * s;
      cap -= c;
    }
    return ub;
  };
  /** 파티마다 배율 합이 기준치 이상이어야 하므로 파티 수 ≤ 남은 배율 합 ÷ 기준치 */
  const partyCap = (minus: number) => {
    let cap = Infinity;
    for (let k = 0; k < B; k++) cap = Math.min(cap, Math.floor((avail[k] - (minus >= 0 ? rate[minus * B + k] : 0)) / thr[k] + EPS));
    return cap;
  };
  /** 남은 캐릭터로 얻을 수 있는 점수 상한. 반드시 넣을 캐릭터를 다 넣을 수 없으면 -1 */
  const restBound = () => {
    const cap = partyCap(-1);
    if (reqLeft > 0) {
      if (cap * maxSize < reqLeft) return -1;
      // 같은 플레이어 캐릭터는 서로 다른 파티에 가야 한다
      for (let p = 0; p < P; p++) if (reqPerPlayer[p] > cap) return -1;
    }
    return fillBound(availLeft, cap);
  };

  interface Sol {
    score: number;
    maxSpread: number;
    sumSpread: number;
    parties: number[][];
  }
  let best: Sol | null = null;
  let firstOnly = false;
  const chosen: number[][] = [];
  const beats = (score: number, mx: number, sm: number, than: Sol | null = best) =>
    !than || score > than.score || (score === than.score && (mx < than.maxSpread - EPS || (mx <= than.maxSpread + EPS && sm < than.sumSpread - EPS)));

  const spreadOf = (ms: number[]) => {
    let spread = 0;
    for (let k = 0; k < B; k++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const m of ms) {
        lo = Math.min(lo, rate[m * B + k]);
        hi = Math.max(hi, rate[m * B + k]);
      }
      spread = Math.max(spread, (hi - lo) / thr[k]);
    }
    return spread;
  };

  /** i가 가장 앞(쿨감 최저)인 s명 파티 후보: 아직 처리하지 않은 캐릭터만 */
  const partyMembers: number[] = [];
  const partySums = new Float64Array(B);
  const partyPlayer = new Uint8Array(P);
  const partiesWith = (i: number, s: number): { ms: number[]; spread: number }[] => {
    const out: { ms: number[]; spread: number }[] = [];
    const rec = (from: number) => {
      if (tick()) return;
      if (partyMembers.length === s) {
        for (let k = 0; k < B; k++) if (partySums[k] < thr[k] - EPS) return;
        out.push({ ms: partyMembers.slice(), spread: spreadOf(partyMembers) });
        return;
      }
      for (let j = from; j < n; j++) {
        if (cd[j] - cd[i] > cdThr + EPS) break;
        if (!mark[j] || used[j] || partyPlayer[pl[j]]) continue;
        partyMembers.push(j);
        partyPlayer[pl[j]] = 1;
        for (let k = 0; k < B; k++) partySums[k] += rate[j * B + k];
        rec(j + 1);
        for (let k = 0; k < B; k++) partySums[k] -= rate[j * B + k];
        partyPlayer[pl[j]] = 0;
        partyMembers.pop();
        if (aborted) return;
      }
    };
    partyMembers.push(i);
    partyPlayer[pl[i]] = 1;
    for (let k = 0; k < B; k++) partySums[k] = rate[i * B + k];
    rec(i + 1);
    partyPlayer[pl[i]] = 0;
    partyMembers.pop();
    return out.sort((a, b) => a.spread - b.spread);
  };

  /** 쿨감 순으로 아직 처리하지 않은 첫 캐릭터를 파티에 넣거나(선택이면) 뺀다 */
  const search = (i: number, score: number, mx: number, sm: number) => {
    if (tick() || (firstOnly && best)) return;
    while (i < n && (!mark[i] || used[i])) i++;
    if (i === n) {
      if (beats(score, mx, sm)) best = { score, maxSpread: mx, sumSpread: sm, parties: chosen.map((p) => p.slice()) };
      return;
    }
    const ub = restBound();
    if (ub < 0 || !beats(score + ub, mx, sm)) return;
    // 존재만 확인할 때는 선택 캐릭터를 먼저 빼 본다: 반드시 넣을 캐릭터의 파티를 빨리 찾는다
    const skipFirst = firstOnly && mark[i] === 2;
    if (skipFirst) {
      setUsed(i, true);
      search(i + 1, score, mx, sm);
      setUsed(i, false);
      if (aborted || best) return;
    }
    for (let s = Math.max(1, minSize); s <= maxSize; s++) {
      if (availLeft < s) break;
      // i가 s명 파티에 들어가면 얻을 수 있는 점수 상한. s가 클수록 줄어든다
      const ubS = score + weight[s] + fillBound(availLeft - s, partyCap(i));
      if (best && !beats(ubS, mx, sm)) break;
      for (const p of partiesWith(i, s)) {
        if (aborted) return;
        // 후보는 편차 오름차순: 이 파티로 최선을 못 넘으면 뒤 후보도 못 넘는다
        if (best && !beats(ubS, Math.max(mx, p.spread), sm + p.spread)) break;
        p.ms.forEach((m) => setUsed(m, true));
        chosen.push(p.ms);
        search(i + 1, score + weight[s], Math.max(mx, p.spread), sm + p.spread);
        chosen.pop();
        p.ms.forEach((m) => setUsed(m, false));
        if (aborted || (firstOnly && best)) return;
      }
    }
    if (mark[i] === 2 && !skipFirst) {
      setUsed(i, true);
      search(i + 1, score, mx, sm);
      setUsed(i, false);
    }
  };
  /** init: 이미 아는 구성(최적화의 출발점) */
  const run = (onlyFeasible: boolean, init: Sol | null = null) => {
    prepare();
    best = init;
    firstOnly = onlyFeasible;
    search(0, 0, 0, 0);
    return best as Sol | null;
  };

  // ---- 1. 컷마다: 상위 k명 안에서 순위대로, 넣고도 파티를 짤 수 있으면 넣는다 ----
  const empty: Sol = { score: 0, maxSpread: 0, sumSpread: 0, parties: [] };
  let complete = true;
  // 지금까지의 결정(넣음·뺌)을 모두 만족하는 구성 하나. 앞 컷의 것은 다음 컷에서도 그대로 성립한다
  let witness = empty;
  const membersOf = (sol: Sol) => new Set(sol.parties.flat());
  let inWitness = membersOf(witness);
  /** 서로 다른 구성원 집합마다 (컷, 그 집합의 파티 구성 하나) */
  const cuts: { k: number; members: number[]; witness: Sol }[] = [];
  let prevMembers = '';
  for (let k = 1; k <= n; k++) {
    const t = now();
    if (t > deadline) {
      complete = false;
      break;
    }
    // 이 단계는 보통 금방 끝난다. 남은 시간의 절반을 남은 컷 수로 나눠 상한으로 둔다
    sliceEnd = t + (deadline - t) / (2 * (n - k + 1));
    aborted = false;
    mark.fill(0);
    for (let j = 0; j < k; j++) mark[rankOrder[j]] = 2;
    for (let j = 0; j < k; j++) {
      const c = rankOrder[j];
      mark[c] = 1;
      if (inWitness.has(c)) continue;
      const w = run(true);
      if (w) {
        witness = w;
        inWitness = membersOf(w);
      } else mark[c] = 0;
    }
    if (aborted) complete = false;
    // 구성원이 앞 컷과 같으면(새 캐릭터를 못 넣음) 결과도 같다
    const members = [...inWitness].sort((x, y) => x - y);
    const key = members.join(',');
    if (key === prevMembers || members.length === 0) continue;
    prevMembers = key;
    cuts.push({ k, members, witness });
  }

  // ---- 2. 각 구성원 집합을 빠짐없이 파티로 나누는 최적 구성. 지금까지의 최선을 넘는 것만 찾는다 ----
  // 사람이 많은 컷이 보통 파티도 많아, 큰 컷부터 보면 가지치기가 잘 된다
  let bestSol = empty;
  let bestCut = 0;
  cuts.sort((a, b) => b.members.length - a.members.length || b.k - a.k);
  // 시간을 나눠 한 바퀴 돌고, 시간 안에 못 끝낸 컷은 남은 시간으로 다시 (그사이 최선이 좋아져 가지치기가 더 잘 된다)
  let pending = cuts;
  while (pending.length > 0) {
    const unfinished: typeof cuts = [];
    pending.forEach((cut, x) => {
      const t = now();
      sliceEnd = t + Math.max(0, deadline - t) / (pending.length - x);
      aborted = false;
      mark.fill(0);
      cut.members.forEach((m) => (mark[m] = 1));
      const start = beats(cut.witness.score, cut.witness.maxSpread, cut.witness.sumSpread, bestSol) ? cut.witness : bestSol;
      const sol = run(false, start)!;
      if (aborted) unfinished.push(cut);
      if (sol !== bestSol) {
        bestSol = sol;
        bestCut = cut.k;
      }
    });
    if (unfinished.length === pending.length && now() >= deadline) {
      complete = false;
      break;
    }
    pending = unfinished;
  }
  result.optimal = complete;

  // ---- 결과 정리 ----
  const assigned = new Uint8Array(n);
  result.parties = bestSol.parties
    .map((ms): PartyResult => {
      ms.forEach((m) => (assigned[m] = 1));
      let slack = Infinity;
      for (let k = 0; k < B; k++) slack = Math.min(slack, ms.reduce((a, m) => a + rate[m * B + k], 0) / thr[k]);
      return {
        memberIds: ms.map((m) => eligible[m].id),
        rateSums: target.bosses.map((_, k) => ms.reduce((a, m) => a + rate[m * B + k], 0)),
        slack,
        spread: spreadOf(ms),
        cooldownMin: cd[ms[0]],
        cooldownMax: cd[ms[ms.length - 1]],
      };
    })
    .sort((a, b) => a.memberIds.length - b.memberIds.length || a.spread - b.spread);
  result.maxSpread = bestSol.maxSpread;
  result.sumSpread = bestSol.sumSpread;

  // 남은 캐릭터의 사유. 조합 존재 확인은 짧게만 한다(시간이 다 되면 '조합 있음'으로 본다)
  sliceEnd = now() + Math.max(50, timeLimitMs * 0.05);
  for (let i = 0; i < n; i++) {
    if (assigned[i]) continue;
    let reason: Reason;
    if (n < minSize) reason = 'NOT_ENOUGH_MEMBERS';
    else if (P < minSize) reason = 'SAME_PLAYER';
    else if (!cooldownWindowOk(i)) reason = 'COOLDOWN';
    else if (!inAnyParty(i)) reason = 'NO_COMBINATION';
    else reason = rankPos[i] < bestCut ? 'RANK_BLOCKED' : 'EXCLUDED';
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

  /** i가 들어가는 파티가 하나라도 있는가 (다른 캐릭터는 모두 넣어도 되고 빼도 됨) */
  function inAnyParty(i: number): boolean {
    mark.fill(2);
    mark[i] = 1;
    aborted = false;
    return !!run(true) || aborted;
  }
}
