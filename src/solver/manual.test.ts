import { describe, expect, test } from 'vitest';
import { SAMPLE_DATA } from './sample';
import { buildTargets } from './targets';
import { solveTarget, TargetResult } from './solve';
import { crossDifficultyConflicts, evaluateParty, moveMember, rankViolations } from './manual';

const chars = new Map(SAMPLE_DATA.characters.map((c) => [c.id, c]));
const targets = buildTargets(SAMPLE_DATA);
const result = (name: string) => solveTarget(targets.find((t) => t.name === name)!, SAMPLE_DATA.characters, 10000);

describe('moveMember', () => {
  const parties = [['c1', 'c8'], ['c5', 'c6']];
  test('다른 파티로 이동', () => expect(moveMember(parties, 'c8', 1)).toEqual([['c1'], ['c5', 'c6', 'c8']]));
  test('미배정으로 빼도 빈 파티는 남음', () =>
    expect(moveMember(moveMember(parties, 'c1', -1), 'c8', -1)).toEqual([[], ['c5', 'c6']]));
  test('빈 파티로 이동', () => expect(moveMember([['c1', 'c8'], []], 'c8', 1)).toEqual([['c1'], ['c8']]));
  test('새 파티', () => expect(moveMember(parties, 'c9', 2)).toEqual([['c1', 'c8'], ['c5', 'c6'], ['c9']]));
  test('원본은 그대로', () => {
    moveMember(parties, 'c1', 1);
    expect(parties).toEqual([['c1', 'c8'], ['c5', 'c6']]);
  });
});

describe('evaluateParty', () => {
  const r = result('루시드+윌');
  test('계산 결과 파티는 경고 없음, 값이 계산기와 같음', () => {
    for (const p of r.parties) {
      const e = evaluateParty(r, p.memberIds, chars);
      expect(e.warnings).toEqual([]);
      expect(e.rateSums).toEqual(p.rateSums);
      expect(e.slack).toBeCloseTo(p.slack, 9);
      expect(e.spread).toBeCloseTo(p.spread, 9);
    }
  });
  test('여유율 가장 낮은 보스: c1+c8은 루시드 105, 윌 100 → 윌', () => {
    const e = evaluateParty(r, ['c1', 'c8'], chars);
    expect(e.tightest).toBe(1);
    expect(e.slack).toBeCloseTo(1, 9);
  });
  test('기준치 미달·인원 부족·같은 플레이어·배율 미입력·쿨감', () => {
    expect(evaluateParty(r, ['c1'], chars).warnings).toEqual(['인원 부족 (1/2명)', '루시드 기준치 미달 (60%/100%)', '윌 기준치 미달 (55%/100%)']);
    expect(evaluateParty(r, ['c1', 'c2', 'c6'], chars).warnings).toEqual(['같은 플레이어 캐릭터가 둘 이상']);
    expect(evaluateParty(r, ['c3', 'c6', 'c4'], chars).warnings).toEqual(['윌 배율 미입력: 철수삼캐']);
    expect(evaluateParty(r, ['c6', 'c10', 'c4'], chars).warnings).toEqual(['쿨감 범위 초과 (0~15초)']);
  });
});

describe('rankViolations', () => {
  const r = result('루시드+윌');
  const avg = (id: string) => (chars.get(id)!.rates[r.bossIds[0]] + chars.get(id)!.rates[r.bossIds[1]]) / 2;
  test('계산 결과는 위반 없음', () => {
    const parties = r.parties.map((p) => p.memberIds);
    const out = r.unassigned.filter((u) => u.reason === 'EXCLUDED').map((u) => u.characterId);
    expect(rankViolations(r, parties, out, chars)).toEqual([]);
  });
  test('파티 구성원을 빼면 그보다 낮은 구성원이 위반으로 잡힘', () => {
    const parties = r.parties.map((p) => p.memberIds);
    const top = [...parties.flat()].sort((a, b) => avg(b) - avg(a))[0];
    const edited = parties.map((p) => p.filter((id) => id !== top));
    const v = rankViolations(r, edited, [top], chars);
    expect(v).toHaveLength(1);
    expect(v[0].id).toBe(top);
    expect(v[0].lower.sort()).toEqual(edited.flat().filter((id) => avg(id) < avg(top)).sort());
  });
});

describe('crossDifficultyConflicts', () => {
  const mk = (key: string, name: string, bossNames: string[], parties: string[][]) =>
    ({ key, name, bossNames, parties: parties.map((memberIds) => ({ memberIds })) }) as unknown as TargetResult;
  test('같은 보스 다른 난이도에 겹친 캐릭터만', () => {
    const rs = [
      mk('a', '하드 세렌', ['하드 세렌'], [['x', 'y']]),
      mk('b', '노말 세렌', ['노말 세렌'], [['y', 'z']]),
      mk('c', '카링', ['노말 카링'], [['x']]),
    ];
    const c = crossDifficultyConflicts(rs, (r) => r.parties.map((p) => p.memberIds));
    expect([...c.get('a')!]).toEqual([['y', ['노말 세렌']]]);
    expect([...c.get('b')!]).toEqual([['y', ['하드 세렌']]]);
    expect(c.get('c')!.size).toBe(0);
  });
});
