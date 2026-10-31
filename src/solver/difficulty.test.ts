import { describe, expect, test } from 'vitest';
import { AppData, Boss, Character } from '../types';
import { bossKind, groupByFamily } from '../bossFamily';
import { buildTargets } from './targets';
import { orderTargets, solveAll } from './solveAll';
import { bruteForce } from './bruteforce';

const boss = (id: string, name: string, over: Partial<Boss> = {}): Boss => ({
  id, name, minSize: 1, maxSize: 2, rateThreshold: 100, cooldownThreshold: 10, enabled: true, ...over,
});
const ch = (id: string, rates: Record<string, number>): Character => ({ id, name: id, playerId: `p-${id}`, cooldown: 0, rates });

describe('보스 이름에서 난이도 인식', () => {
  test.each([
    ['하드 카링', '카링', '하드'],
    ['익스트림 검은마법사', '검은마법사', '익스트림'],
    ['  카오스   더스크 ', '더스크', '카오스'],
    ['자쿰', '자쿰', undefined],
    ['하드', '하드', undefined],
    ['하드카링', '하드카링', undefined],
  ])('%s', (name, family, difficulty) => {
    const k = bossKind(name);
    expect([k.family, k.difficulty]).toEqual([family, difficulty]);
  });

  test('같은 보스끼리 묶고 높은 난이도부터, 보스는 처음 나온 순서', () => {
    const fs = groupByFamily([boss('1', '노말 윌'), boss('2', '하드 루시드'), boss('3', '하드 윌'), boss('4', '이지 윌'), boss('5', '')]);
    expect(fs.map((f) => [f.family, f.bosses.map((b) => b.id)])).toEqual([
      ['윌', ['3', '1', '4']],
      ['루시드', ['2']],
      ['', ['5']],
    ]);
  });
});

describe('한 캐릭터는 같은 보스에서 한 난이도만', () => {
  // 2인 보스, 기준치 100% (100% 이상은 솔로 가능이라 제외)
  // 하드: a+b(편차 0.2) / a+c(편차 0.1) 중 한 파티만 가능 → 고른 a+c. 노말에는 b, d만 남아 b+d.
  const data: AppData = {
    players: ['a', 'b', 'c', 'd'].map((x) => ({ id: `p-${x}`, name: x })),
    characters: [
      ch('a', { h: 60, n: 60 }),
      ch('b', { h: 40, n: 40 }),
      ch('c', { h: 50, n: 50 }),
      ch('d', { n: 60 }),
    ],
    // 목록 순서를 일부러 노말 먼저
    bosses: [boss('n', '노말 X'), boss('h', '하드 X')],
    groups: [],
  };

  test('높은 난이도부터 계산하고, 배정된 캐릭터는 낮은 난이도에서 빠진다', () => {
    const [hard, normal] = solveAll(data, 2000);
    expect(hard.name).toBe('하드 X');
    expect(hard.parties.map((p) => [...p.memberIds].sort().join('+'))).toEqual(['a+c']);
    expect(normal.parties.map((p) => [...p.memberIds].sort().join('+'))).toEqual(['b+d']);
    expect(Object.fromEntries(normal.unassigned.map((u) => [u.characterId, u.reason]))).toEqual({
      a: 'OTHER_DIFFICULTY', c: 'OTHER_DIFFICULTY',
    });

    // 완전탐색으로 확인
    const [ht, nt] = orderTargets(buildTargets(data));
    expect(bruteForce(ht, data.characters).parties).toEqual([['a', 'c']]);
    expect(bruteForce(nt, data.characters.filter((c) => c.id === 'b' || c.id === 'd')).parties).toEqual([['b', 'd']]);
  });

  test('다른 보스는 서로 영향 없음', () => {
    const d2 = { ...data, bosses: [boss('n', '노말 Y'), boss('h', '하드 X')] };
    const r = solveAll(d2, 2000);
    // 하드 X에 a,c가 배정돼도 노말 Y는 4명 모두로 2인 2파티
    expect(r.find((x) => x.name === '노말 Y')!.parties.length).toBe(2);
    const yt = buildTargets(d2).find((t) => t.name === '노말 Y')!;
    expect(bruteForce(yt, d2.characters).count).toBe(2);
  });

  test('그룹 안의 보스도 같은 규칙: 하드 그룹에 배정된 캐릭터는 노말 단독에서 빠진다', () => {
    const d3: AppData = {
      ...data,
      characters: data.characters.map((c) => ({ ...c, rates: { ...c.rates, z: 50 } })),
      bosses: [boss('n', '노말 X'), boss('h', '하드 X'), boss('z', 'Z')],
      groups: [{ id: 'g', name: 'G', bossIds: ['h', 'z'] }],
    };
    const r = solveAll(d3, 2000);
    expect(r.map((x) => x.name)).toEqual(['G', '노말 X']);
    const taken = new Set(r[0].parties.flatMap((p) => p.memberIds));
    expect(taken.size).toBeGreaterThan(0);
    const normal = r[1];
    expect(normal.parties.flatMap((p) => p.memberIds).some((id) => taken.has(id))).toBe(false);
    expect(normal.unassigned.filter((u) => u.reason === 'OTHER_DIFFICULTY').map((u) => u.characterId).sort()).toEqual([...taken].sort());
  });
});

describe('그룹과 계산 순서', () => {
  test('같은 보스의 두 난이도를 한 그룹에 넣으면 오류', () => {
    const t = buildTargets({ players: [], characters: [], bosses: [boss('h', '하드 X'), boss('n', '노말 X')], groups: [{ id: 'g', name: 'G', bossIds: ['h', 'n'] }] });
    expect(t[0].error).toContain('같은 보스의 다른 난이도');
  });

  test('그룹끼리 순서가 꼬여도 모든 대상을 한 번씩 계산', () => {
    const bosses = [boss('hk', '하드 카링'), boss('ns', '노말 세렌'), boss('nk', '노말 카링'), boss('hs', '하드 세렌')];
    const groups = [
      { id: 'a', name: 'A', bossIds: ['hk', 'ns'] },
      { id: 'b', name: 'B', bossIds: ['nk', 'hs'] },
    ];
    const names = orderTargets(buildTargets({ players: [], characters: [], bosses, groups })).map((t) => t.name);
    expect(names).toEqual(['A', 'B']);
  });
});
