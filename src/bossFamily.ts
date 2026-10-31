import { Boss } from './types';

/** 높은 난이도부터. 보스 이름 앞에 붙은 난이도로 같은 보스를 알아본다 */
export const DIFFICULTIES = ['익스트림', '카오스', '하드', '노말', '이지'] as const;

export interface BossKind {
  /** 난이도를 뗀 보스 이름. 난이도가 없으면 이름 전체 */
  family: string;
  /** 난이도가 없으면 undefined */
  difficulty?: string;
  /** DIFFICULTIES 안 순서(작을수록 높은 난이도). 난이도가 없으면 DIFFICULTIES.length */
  rank: number;
}

export function bossKind(name: string): BossKind {
  const t = name.trim().replace(/\s+/g, ' ');
  for (let i = 0; i < DIFFICULTIES.length; i++) {
    const d = DIFFICULTIES[i];
    if (t.startsWith(d + ' ') && t.length > d.length + 1) return { family: t.slice(d.length + 1), difficulty: d, rank: i };
  }
  return { family: t, rank: DIFFICULTIES.length };
}

/** 같은 보스(난이도만 다른)끼리 묶는다. 보스는 처음 나온 순서, 묶음 안은 높은 난이도부터 */
export function groupByFamily(bosses: Boss[]): { family: string; bosses: Boss[] }[] {
  const map = new Map<string, Boss[]>();
  for (const b of bosses) {
    // 이름 없는 보스는 서로 묶지 않는다
    const f = bossKind(b.name).family || `\0${b.id}`;
    map.set(f, [...(map.get(f) ?? []), b]);
  }
  return [...map].map(([family, bs]) => ({
    family: family.startsWith('\0') ? '' : family,
    bosses: bs
      .map((b, i) => ({ b, i, r: bossKind(b.name).rank }))
      .sort((x, y) => x.r - y.r || x.i - y.i)
      .map((x) => x.b),
  }));
}
