import { describe, expect, test } from 'vitest';
import { applySheet, matchBossHeader, parseRate, parseSheet } from './sheet';
import { DEFAULT_BOSSES } from '../defaultBosses';
import { DEFAULT_DATA } from '../storage';
// 실제로 받은 엑셀 표(헥환 열이 이름 앞에 있음, 마지막 열 제목이 비어 있음)
import tsv from './__fixtures__/sheet-sample.tsv?raw';

const id = (name: string) => DEFAULT_BOSSES.find((b) => b.name === name)!.id;

describe('표 붙여넣기', () => {
  const sheet = parseSheet(tsv, DEFAULT_BOSSES);

  test('열 역할: 이름 앞 열은 무시, 줄임말 제목은 보스로, 마지막 열은 플레이어', () => {
    expect(sheet.columns.map((c) => [c.header, c.role, c.boss?.name])).toEqual([
      ['헥환', 'ignore', undefined],
      ['이름', 'name', undefined],
      ['하드발드', 'boss', '하드 발드릭스'],
      ['하드벨로나', 'boss', '하드 벨로나'],
      ['하드림보', 'boss', '하드 림보'],
      ['노말발드', 'boss', '노말 발드릭스'],
      ['노말림보', 'boss', '노말 림보'],
      ['', 'player', undefined],
    ]);
  });

  test('줄 수와 플레이어', () => {
    expect(sheet.rows).toHaveLength(20);
    expect(sheet.droppedRows).toBe(0);
    expect([...new Set(sheet.rows.map((r) => r.player))]).toEqual(['갓', '파', '두', '찍', '껨', '도', '앜', '뱀', '다', '반']);
  });

  test('숫자가 아닌 칸과 빈 칸은 무시', () => {
    const row = (n: string) => sheet.rows.find((r) => r.name === n)!;
    expect(row('껌껌').rates).toEqual({ [id('하드 벨로나')]: 33.45, [id('하드 림보')]: 41.11, [id('노말 발드릭스')]: 59.8 });
    expect(row('껌껌').skipped).toEqual({ [id('노말 림보')]: '노말림보' });
    expect(row('arcLara').rates).toEqual({ [id('하드 림보')]: 32.67, [id('노말 발드릭스')]: 41.22, [id('노말 림보')]: 64.96 });
    expect(row('arcLara').skipped).toEqual({ [id('하드 발드릭스')]: '포스30' });
    expect(row('반쳐렌').rates).toEqual({ [id('노말 발드릭스')]: 1.1, [id('노말 림보')]: 36.92 });
    expect(row('성풀').rates[id('노말 발드릭스')]).toBeUndefined();
  });

  test('보스 제목 맞추기', () => {
    const name = (h: string) => {
      const m = matchBossHeader(h, DEFAULT_BOSSES);
      return Array.isArray(m) ? m.map((b) => b.name) : m?.name;
    };
    expect(name('하드 발드릭스')).toBe('하드 발드릭스');
    expect(name('하드검마')).toBe('하드 검은마법사');
    expect(name('노말 세렌')).toBe('노말 세렌');
    expect(name('익스카')).toEqual(undefined);
    expect(name('헥환')).toBeUndefined();
    expect(name('카오스')).toBeUndefined();
  });

  test('숫자 읽기', () => {
    expect(parseRate('49.18%')).toBe(49.18);
    expect(parseRate('1,234.5')).toBe(1234.5);
    expect(parseRate('포스30')).toBeUndefined();
    expect(parseRate('-3')).toBeUndefined();
  });

  test('적용: 플레이어·캐릭터 생성, 표에 나온 보스만 켬', () => {
    const d = applySheet(DEFAULT_DATA, sheet);
    expect(d.players.map((p) => p.name)).toEqual(['갓', '파', '두', '찍', '껨', '도', '앜', '뱀', '다', '반']);
    expect(d.characters).toHaveLength(20);
    const god = d.players.find((p) => p.name === '갓')!.id;
    expect(d.characters.filter((c) => c.playerId === god).map((c) => c.name)).toEqual(['호차', '호마차', '렌차호', '차래기', '인종전환리움']);
    expect(d.bosses.filter((b) => b.enabled).map((b) => b.name)).toEqual(['하드 발드릭스', '노말 발드릭스', '하드 림보', '노말 림보', '하드 벨로나']);
  });

  test('다시 적용: 기존 캐릭터는 표의 배율만 덮어쓰고, 무시한 칸·쿨감·다른 보스 배율은 유지', () => {
    const first = applySheet(DEFAULT_DATA, sheet);
    const edited = {
      ...first,
      characters: first.characters.map((c) =>
        c.name === '껌껌' ? { ...c, cooldown: 3, rates: { ...c.rates, [id('노말 림보')]: 70, [id('하드 세렌')]: 20 } } : c,
      ),
    };
    const again = applySheet(edited, parseSheet(tsv.replace('41.11', '45'), DEFAULT_BOSSES));
    expect(again.players).toHaveLength(10);
    expect(again.characters).toHaveLength(20);
    const c = again.characters.find((x) => x.name === '껌껌')!;
    expect(c.cooldown).toBe(3);
    expect(c.rates).toEqual({
      [id('하드 벨로나')]: 33.45,
      [id('하드 림보')]: 45,
      [id('노말 발드릭스')]: 59.8,
      [id('노말 림보')]: 70,
      [id('하드 세렌')]: 20,
    });
  });

  test('이름 열 제목이 없으면 첫 열이 이름', () => {
    const s = parseSheet('캐릭\t하드 윌\t\nA\t30\tP\n\t40\tP\nB\t50\t\n', DEFAULT_BOSSES);
    expect(s.rows.map((r) => [r.name, r.player, r.rates])).toEqual([['A', 'P', { [id('하드 윌')]: 30 }]]);
    expect(s.droppedRows).toBe(2);
  });
});
