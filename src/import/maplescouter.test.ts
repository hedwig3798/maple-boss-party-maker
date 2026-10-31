// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { iconToBossName, matchBosses, parseMaplescouter } from './maplescouter';
import { DEFAULT_BOSSES } from '../defaultBosses';
// 실제 「효율∙보스컷」 페이지 카드 구조를 줄여 옮긴 것
import html from './__fixtures__/maplescouter-result.html?raw';

describe('환산주스탯 붙여넣기', () => {
  const parsed = parseMaplescouter(html);

  test('캐릭터 이름', () => {
    expect(parsed.characterName).toBe('호차');
  });

  test('카드별 배율: [파티] 표기는 숫자만, 같은 아이콘은 첫 카드만, 보스 카드 밖의 %는 무시', () => {
    expect(parsed.cards.map((c) => [c.icon, c.rate, c.ignored])).toEqual([
      ['hard_jupiter', 38, false],
      ['extreme_kaling', 123, false],
      ['extreme_adversary', 30.91, false],
      ['destiny_bardrix', 49.18, true],
      ['hard_bardrix', 49.18, false],
      ['extreme_blackMage', 133.2, false],
      ['champion_kalos', 575.2, true],
      ['normal_kalos', 821.8, false],
      ['hard_mystery', 50, false],
    ]);
  });

  test('기본 보스 목록과 이름으로 맞추기', () => {
    const r = matchBosses(parsed.cards, DEFAULT_BOSSES);
    expect(r.matched.map((m) => [m.boss.name, m.rate])).toEqual([
      ['하드 유피테르', 38],
      ['익스트림 카링', 123],
      ['익스트림 대적자', 30.91],
      ['하드 발드릭스', 49.18],
      ['익스트림 검은마법사', 133.2],
      ['노말 칼로스', 821.8],
    ]);
    expect(Object.keys(r.rates)).toHaveLength(6);
    expect(r.ignored.map((c) => c.icon)).toEqual(['destiny_bardrix', 'champion_kalos']);
    expect(r.unknown.map((c) => c.icon)).toEqual(['hard_mystery']);
    expect(r.missingBoss).toEqual([]);
  });

  test('앱에 없는 이름은 missingBoss로', () => {
    const bosses = DEFAULT_BOSSES.filter((b) => b.name !== '노말 칼로스');
    expect(matchBosses(parsed.cards, bosses).missingBoss.map((c) => c.icon)).toEqual(['normal_kalos']);
  });

  test('기본 보스 목록의 모든 이름이 아이콘으로 만들어질 수 있음', () => {
    const diffs = ['easy', 'normal', 'hard', 'chaos', 'extreme'];
    const slugs = ['jupiter', 'bardrix', 'adversary', 'limbo', 'kaling', 'kalos', 'lotus', 'bellona', 'maleficStar', 'seren', 'blackMage', 'dunkel', 'dusk', 'jinHilla', 'will', 'slime', 'lucid', 'damien'];
    const names = new Set(diffs.flatMap((d) => slugs.map((s) => iconToBossName(`${d}_${s}`))));
    expect(DEFAULT_BOSSES.filter((b) => !names.has(b.name)).map((b) => b.name)).toEqual([]);
  });

  test('HTML이 아니거나 카드가 없으면 빈 결과', () => {
    expect(parseMaplescouter('그냥 글자')).toEqual({ characterName: undefined, cards: [] });
  });
});
