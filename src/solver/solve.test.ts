import { describe, expect, test } from 'vitest';
import { SAMPLE_DATA } from './sample';
import { AppData, Character, DEFAULT_WEAK_RATIO } from '../types';
import { buildTargets, Target, validateBoss } from './targets';
import { DEFAULT_BOSSES } from '../defaultBosses';
import { DEFAULT_DATA, normalize } from '../storage';
import { Reason, solveTarget } from './solve';
import { bruteForce } from './bruteforce';

const partiesOf = (r: ReturnType<typeof solveTarget>) =>
  r.parties.map((p) => [...p.memberIds].sort().join('+')).sort();
const reasonsOf = (r: ReturnType<typeof solveTarget>) =>
  Object.fromEntries(r.unassigned.map((u) => [u.characterId, u.reason]));

describe('예시 데이터 정답', () => {
  const targets = buildTargets(SAMPLE_DATA);
  const get = (name: string) => solveTarget(targets.find((t) => t.name === name)!, SAMPLE_DATA.characters, 10000);

  test('대상 구성: 그룹 1개 + 단독 보스 2개', () => {
    expect(targets.map((t) => t.name)).toEqual(['루시드+윌', '진 힐라', '검은 마법사']);
  });

  test('루시드+윌: 2인 2파티 + 3인 1파티, 편차 최대 0.35', () => {
    const r = get('루시드+윌');
    expect(r.optimal).toBe(true);
    expect(partiesOf(r)).toEqual(['c1+c8', 'c2+c4+c9', 'c5+c6']);
    // 인원 → 편차 순 정렬: c1+c8, c5+c6, c2+c4+c9
    expect(r.parties.map((p) => p.spread)).toEqual([0.15, 0.35, 0.25].map((x) => expect.closeTo(x, 9)));
    expect(r.maxSpread).toBeCloseTo(0.35, 9);
    expect(reasonsOf(r)).toEqual({ c3: 'NO_RATE', c7: 'EXCLUDED', c10: 'NO_COMBINATION' });
  });

  test('진 힐라: 2파티', () => {
    const r = get('진 힐라');
    expect(partiesOf(r)).toEqual(['c1+c5+c8', 'c2+c4+c6']);
    expect(r.maxSpread).toBeCloseTo(0.3, 9);
    expect(reasonsOf(r)).toEqual({ c3: 'NO_RATE', c10: 'NO_RATE', c9: 'EXCLUDED', c7: 'COOLDOWN' });
  });

  test('검은 마법사: 본캐 4명 1파티', () => {
    const r = get('검은 마법사');
    expect(partiesOf(r)).toEqual(['c1+c4+c6+c8']);
    expect(reasonsOf(r)).toEqual({
      c2: 'NO_RATE', c3: 'NO_RATE', c7: 'NO_RATE', c10: 'NO_RATE',
      c5: 'NO_COMBINATION', c9: 'NO_COMBINATION',
    });
  });

  test('완전탐색과 목적함수 값 일치', () => {
    for (const t of targets) {
      const r = solveTarget(t, SAMPLE_DATA.characters, 10000);
      const bf = bruteForce(t, SAMPLE_DATA.characters);
      expectSameObjective(r, bf);
    }
  });
});

function expectSameObjective(r: ReturnType<typeof solveTarget>, bf: ReturnType<typeof bruteForce>, msg?: string) {
  const sizes = r.parties.map((p) => p.memberIds.length);
  const bfSizes = bf.parties.map((p) => p.length);
  expect([...sizes].sort(), msg).toEqual([...bfSizes].sort());
  expect(r.maxSpread, msg).toBeCloseTo(bf.maxSpread, 9);
  expect(r.sumSpread, msg).toBeCloseTo(bf.sumSpread, 9);
}

const tgt = (over: Partial<Target> = {}): Target => ({
  key: 't', name: 't', isGroup: false,
  bosses: [{ id: 'b', name: 'b', threshold: 100 }],
  minSize: 2, maxSize: 6, cooldownThreshold: 10, weakRatio: DEFAULT_WEAK_RATIO, ...over,
});
const ch = (id: string, playerId: string, cooldown: number, rate?: number): Character => ({
  id, name: id, playerId, cooldown, rates: rate === undefined ? {} : { b: rate },
});

describe('미배정 사유', () => {
  const cases: [string, Target, Character[], Record<string, Reason>][] = [
    ['배율 미입력', tgt({ minSize: 1 }), [ch('a', 'p1', 0, 60), ch('b', 'p3', 0, 40), ch('x', 'p2', 0)], { x: 'NO_RATE' }],
    ['솔로 가능', tgt({ minSize: 1 }), [ch('a', 'p1', 0, 100), ch('b', 'p2', 0, 60), ch('c', 'p3', 0, 40)], { a: 'SOLO' }],
    // 기준값 100 ÷ 6 = 16.7%, 기본 × 0.1 = 1.67% 미만이면 제외
    ['배율 너무 낮음', tgt(), [ch('a', 'p1', 0, 60), ch('b', 'p2', 0, 40), ch('w', 'p3', 0, 1.6)], { w: 'TOO_WEAK' }],
    // 배수를 0.3으로 바꾸면 5% 미만이 제외
    ['배율 너무 낮음 배수 변경', tgt({ weakRatio: 0.3 }), [ch('a', 'p1', 0, 60), ch('b', 'p2', 0, 40), ch('w', 'p3', 0, 4.9)], { w: 'TOO_WEAK' }],
    ['배수 0이면 제외 안 함', tgt({ weakRatio: 0, maxSize: 2 }), [ch('a', 'p1', 0, 60), ch('b', 'p2', 0, 40), ch('w', 'p3', 0, 0)], { w: 'NO_COMBINATION' }], // TOO_WEAK가 아님
    ['참여 인원 부족', tgt({ minSize: 3 }), [ch('a', 'p1', 0, 90), ch('b', 'p2', 0, 90)], { a: 'NOT_ENOUGH_MEMBERS', b: 'NOT_ENOUGH_MEMBERS' }],
    ['같은 플레이어 충돌', tgt(), [ch('a', 'p1', 0, 90), ch('b', 'p1', 0, 90)], { a: 'SAME_PLAYER', b: 'SAME_PLAYER' }],
    ['쿨감 범위 초과', tgt({ cooldownThreshold: 3 }), [ch('a', 'p1', 0, 90), ch('b', 'p2', 1, 90), ch('z', 'p3', 20, 90)], { z: 'COOLDOWN' }],
    ['기준치를 채울 조합 없음', tgt(), [ch('a', 'p1', 0, 30), ch('b', 'p2', 0, 30)], { a: 'NO_COMBINATION', b: 'NO_COMBINATION' }],
    ['최적화 결과 제외', tgt({ maxSize: 2 }), [ch('a', 'p1', 0, 50), ch('b', 'p2', 0, 50), ch('c', 'p3', 0, 50)], { c: 'EXCLUDED' }],
  ];
  test.each(cases)('%s', (_, t, chars, expected) => {
    const r = solveTarget(t, chars, 1000);
    expect(reasonsOf(r)).toEqual(expected);
  });
});

describe('보스 그룹', () => {
  const base: AppData = {
    players: [], characters: [], weakRatio: DEFAULT_WEAK_RATIO, groups: [{ id: 'g', name: 'G', bossIds: ['x', 'y'] }],
    bosses: [
      { id: 'x', name: 'X', minSize: 2, maxSize: 6, rateThreshold: 100, cooldownThreshold: 10 , enabled: true },
      { id: 'y', name: 'Y', minSize: 3, maxSize: 4, rateThreshold: 200, cooldownThreshold: 5 , enabled: true },
      { id: 'z', name: 'Z', minSize: 1, maxSize: 1, rateThreshold: 100, cooldownThreshold: 0 , enabled: true },
    ],
  };
  test('그룹은 가장 엄격한 인원·쿨감을 쓰고, 그룹 보스는 단독 계산하지 않는다', () => {
    const ts = buildTargets(base);
    expect(ts.map((t) => t.name)).toEqual(['G', 'Z']);
    expect(ts[0]).toMatchObject({ minSize: 3, maxSize: 4, cooldownThreshold: 5 });
  });
  test('꺼진 보스는 단독·그룹 계산에서 빠진다', () => {
    const off = (id: string) => base.bosses.map((b) => (b.id === id ? { ...b, enabled: false } : b));
    expect(buildTargets({ ...base, bosses: off('z') }).map((t) => t.name)).toEqual(['G']);
    const g = buildTargets({ ...base, bosses: off('y') });
    expect(g.map((t) => t.name)).toEqual(['G', 'Z']);
    expect(g[0].bosses.map((b) => b.id)).toEqual(['x']);
  });
  test('기본 보스는 모두 꺼져 있어 계산 대상이 없다', () => {
    expect(DEFAULT_BOSSES.every((b) => !b.enabled)).toBe(true);
    expect(buildTargets({ ...DEFAULT_DATA, bosses: DEFAULT_BOSSES })).toEqual([]);
  });
  test('인원 범위가 비면 오류', () => {
    const ts = buildTargets({ ...base, groups: [{ id: 'g', name: 'G', bossIds: ['x', 'z'] }] });
    expect(ts[0].error).toMatch(/인원 범위/);
  });
  test('그룹 내 모든 보스의 기준치를 각각 만족해야 한다', () => {
    const t = tgt({ bosses: [{ id: 'x', name: 'X', threshold: 100 }, { id: 'y', name: 'Y', threshold: 100 }] });
    const chars: Character[] = [
      { id: 'a', name: 'a', playerId: 'p1', cooldown: 0, rates: { x: 80, y: 40 } },
      { id: 'b', name: 'b', playerId: 'p2', cooldown: 0, rates: { x: 80, y: 40 } },
    ];
    expect(solveTarget(t, chars, 1000).parties).toHaveLength(0);
    chars[1].rates.y = 70;
    const r = solveTarget(t, chars, 1000);
    expect(r.parties).toHaveLength(1);
    expect(r.parties[0].slack).toBeCloseTo(1.1, 9); // min(160/100, 110/100)
  });
});

describe('목적 우선순위', () => {
  test('작은 파티부터 최대한 많이: 3인+3인보다 2인+4인', () => {
    // A+B(100%)가 유일한 2인 파티, 남은 C~F는 4명이 모여야 120%
    const chars = [ch('A', 'pA', 0, 50), ch('B', 'pB', 0, 50), ...['C', 'D', 'E', 'F'].map((x) => ch(x, `p${x}`, 0, 30))];
    const r = solveTarget(tgt(), chars, 1000);
    expect(partiesOf(r)).toEqual(['A+B', 'C+D+E+F']);
    expectSameObjective(r, bruteForce(tgt(), chars));
  });

  test('인원 구성이 같으면 파티 안 배율이 고른 쪽 (가장 들쭉날쭉한 파티 기준)', () => {
    // a70+b35 / c65+d40 → 편차 0.35, 0.25 / a70+d40 / c65+b35 → 편차 0.30, 0.30
    const chars = [ch('a', 'p1', 0, 70), ch('b', 'p2', 0, 35), ch('c', 'p3', 0, 65), ch('d', 'p4', 0, 40)];
    const t = tgt({ maxSize: 2 });
    const r = solveTarget(t, chars, 1000);
    expect(partiesOf(r)).toEqual(['a+d', 'b+c']);
    expect(r.maxSpread).toBeCloseTo(0.3, 9);
    expectSameObjective(r, bruteForce(t, chars));
  });

  test('배율 순위: 낮은 배율이 가고 높은 배율이 남지 않는다', () => {
    // 순위 없이 2인 파티를 많이 만들면 A+E, B+D로 C(40)가 빠진다. 순위 규칙이면 E(20)가 빠진다
    const chars = [ch('A', 'pA', 0, 80), ch('B', 'pB', 0, 70), ch('C', 'pC', 0, 40), ch('D', 'pD', 0, 30), ch('E', 'pE', 0, 20)];
    const r = solveTarget(tgt(), chars, 1000);
    expect(partiesOf(r)).toEqual(['A+C', 'B+D']);
    expect(reasonsOf(r)).toEqual({ E: 'EXCLUDED' });
    expectSameObjective(r, bruteForce(tgt(), chars));
  });

  test('배율 순위: 한 명씩은 못 넣어도 둘을 함께 넣을 수 있으면 넣는다', () => {
    // 2인 보스: A+B 다음 C 혼자는 못 넣지만 C·D를 함께 넣으면 A+C, B+D
    const t = tgt({ maxSize: 2 });
    const chars = [ch('A', 'pA', 0, 80), ch('B', 'pB', 0, 75), ch('C', 'pC', 0, 30), ch('D', 'pD', 0, 25)];
    const r = solveTarget(t, chars, 1000);
    expect(partiesOf(r)).toEqual(['A+C', 'B+D']);
    expectSameObjective(r, bruteForce(t, chars));
  });

  test('배율 순위: 윗순위를 넣으면 못 들어가는 캐릭터만 건너뛴다', () => {
    // 2인 보스. E(70)·B(65)는 같은 플레이어라 각자 짝이 필요한데 짝이 될 수 있는 건 A(35)뿐 → E+A, B는 건너뜀
    // (완전탐색으로 확인한 값)
    const t = tgt({ maxSize: 2 });
    const chars = [ch('E', 'p0', 0, 70), ch('B', 'p0', 0, 65), ch('A', 'p1', 0, 35), ch('C', 'p3', 0, 15), ch('D', 'p2', 0, 15)];
    const r = solveTarget(t, chars, 1000);
    expect(partiesOf(r)).toEqual(['A+E']);
    expect(reasonsOf(r)).toEqual({ B: 'RANK_BLOCKED', C: 'NO_COMBINATION', D: 'NO_COMBINATION' });
    expectSameObjective(r, bruteForce(t, chars));
  });

  test('그룹 순위는 보스 배율의 단순 평균', () => {
    // 평균: a 60, b 55, c 50, d 45. 2인 파티에 짝수 인원이 아니면 가장 낮은 d가 빠진다
    const t = tgt({ maxSize: 2, bosses: [{ id: 'x', name: 'X', threshold: 100 }, { id: 'y', name: 'Y', threshold: 100 }] });
    const c = (id: string, x: number, y: number): Character => ({ id, name: id, playerId: id, cooldown: 0, rates: { x, y } });
    const r = solveTarget(t, [c('a', 70, 50), c('b', 50, 60), c('c', 50, 50), c('d', 60, 30)], 1000);
    expect(r.unassigned.map((u) => u.characterId)).not.toContain('a');
    expectSameObjective(r, bruteForce(t, [c('a', 70, 50), c('b', 50, 60), c('c', 50, 50), c('d', 60, 30)]));
  });

  test('그룹은 보스 중 하나라도 벗어나면 제외', () => {
    const t = tgt({ bosses: [{ id: 'x', name: 'X', threshold: 100 }, { id: 'y', name: 'Y', threshold: 100 }] });
    const c = (id: string, x: number, y: number): Character => ({ id, name: id, playerId: id, cooldown: 0, rates: { x, y } });
    const r = solveTarget(t, [c('solo', 100, 50), c('weak', 50, 1), c('ok', 50, 50)], 1000);
    expect(reasonsOf(r)).toEqual({ solo: 'SOLO', weak: 'TOO_WEAK', ok: 'NOT_ENOUGH_MEMBERS' });
  });
});

/** 재현 가능한 의사난수 */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
function randomCase(seed: number, nChars: number, nPlayers: number) {
  const r = rng(seed);
  const t = tgt({
    minSize: 1 + Math.floor(r() * 3),
    maxSize: 3 + Math.floor(r() * 4),
    cooldownThreshold: Math.floor(r() * 8),
    bosses: r() < 0.5
      ? [{ id: 'b', name: 'b', threshold: 100 }]
      : [{ id: 'b', name: 'b', threshold: 100 }, { id: 'c', name: 'c', threshold: 120 }],
  });
  const chars: Character[] = Array.from({ length: nChars }, (_, i) => {
    const rates: Record<string, number> = {};
    // 솔로 가능(≥ 기준치)·너무 낮음(< 기준값×0.3)도 섞이도록 1~110%
    for (const b of t.bosses) if (r() < 0.9) rates[b.id] = 1 + Math.floor(r() * 110);
    return { id: `c${i}`, name: `c${i}`, playerId: `p${Math.floor(r() * nPlayers)}`, cooldown: Math.floor(r() * 10), rates };
  });
  return { t, chars };
}

test('무작위 소규모 입력 200개: 완전탐색과 목적함수 값 일치', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const { t, chars } = randomCase(seed, 8, 4);
    const r = solveTarget(t, chars, 10000);
    const bf = bruteForce(t, chars);
    const msg = `seed ${seed}`;
    expect(r.optimal, msg).toBe(true);
    expectSameObjective(r, bf, msg);
    // 결과 파티가 실제로 모든 제약을 만족하는지
    const byId = new Map(chars.map((c) => [c.id, c]));
    const seen = new Set<string>();
    for (const p of r.parties) {
      const ms = p.memberIds.map((id) => byId.get(id)!);
      expect(ms.length).toBeGreaterThanOrEqual(t.minSize);
      expect(ms.length).toBeLessThanOrEqual(t.maxSize);
      expect(new Set(ms.map((m) => m.playerId)).size).toBe(ms.length);
      expect(p.cooldownMax - p.cooldownMin).toBeLessThanOrEqual(t.cooldownThreshold);
      t.bosses.forEach((b, k) => expect(p.rateSums[k]).toBeGreaterThanOrEqual(b.threshold - 1e-9));
      ms.forEach((m) => {
        expect(seen.has(m.id)).toBe(false);
        seen.add(m.id);
      });
    }
  }
});

test('최대 규모(캐릭터 30, 플레이어 10) 시간 제한 준수', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const { t, chars } = randomCase(seed * 7919, 30, 10);
    const r = solveTarget({ ...t, maxSize: 6, cooldownThreshold: 10 }, chars, 3000);
    expect(r.elapsedMs).toBeLessThan(4500);
    console.log(`seed ${seed}: 파티 ${r.parties.length}, 최적 ${r.optimal}, 편차 ${r.maxSpread.toFixed(3)}, ${r.elapsedMs.toFixed(0)}ms`);
  }
});

describe('기본 보스 목록', () => {
  test('49개, 이름·id 중복 없음, 모두 설정 오류 없음', () => {
    expect(DEFAULT_BOSSES).toHaveLength(49);
    expect(new Set(DEFAULT_BOSSES.map((b) => b.name)).size).toBe(49);
    expect(new Set(DEFAULT_BOSSES.map((b) => b.id)).size).toBe(49);
    expect(DEFAULT_BOSSES.filter((b) => validateBoss(b))).toEqual([]);
  });

  test('보스정보 페이지 순: 처음은 하드 유피테르, 끝은 노말 스우', () => {
    expect(DEFAULT_BOSSES[0].name).toBe('하드 유피테르');
    expect(DEFAULT_BOSSES[48].name).toBe('노말 스우');
  });
});

describe('저장 데이터 불러오기', () => {
  test('enabled가 없던 예전 데이터의 보스는 켜진 것으로 본다', () => {
    const d = normalize({ bosses: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', enabled: false }] });
    expect(d.bosses.map((b) => b.enabled)).toEqual([true, false]);
  });

  test('weakRatio가 없거나 음수면 기본값 0.1, 있으면 그대로', () => {
    expect(normalize({ bosses: [] }).weakRatio).toBe(0.1);
    expect(normalize({ bosses: [], weakRatio: -1 }).weakRatio).toBe(0.1);
    expect(normalize({ bosses: [], weakRatio: 0.25 }).weakRatio).toBe(0.25);
  });
});
