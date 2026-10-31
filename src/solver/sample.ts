import { AppData } from '../types';

/** 테스트용 예시: 플레이어 4명, 캐릭터 10개, 보스 4개(그중 2개는 그룹) */
export const SAMPLE_DATA: AppData = {
  players: [
    { id: 'p1', name: '철수' },
    { id: 'p2', name: '영희' },
    { id: 'p3', name: '민준' },
    { id: 'p4', name: '서윤' },
  ],
  bosses: [
    { id: 'lucid', name: '루시드', minSize: 2, maxSize: 6, rateThreshold: 100, cooldownThreshold: 10, enabled: true },
    { id: 'will', name: '윌', minSize: 2, maxSize: 6, rateThreshold: 100, cooldownThreshold: 10, enabled: true },
    { id: 'jhilla', name: '진 힐라', minSize: 3, maxSize: 6, rateThreshold: 100, cooldownThreshold: 5, enabled: true },
    { id: 'bm', name: '검은 마법사', minSize: 4, maxSize: 6, rateThreshold: 100, cooldownThreshold: 20, enabled: true },
  ],
  groups: [{ id: 'g1', name: '루시드+윌', bossIds: ['lucid', 'will'] }],
  characters: [
    { id: 'c1', name: '철수본캐', playerId: 'p1', cooldown: 0, rates: { lucid: 60, will: 55, jhilla: 45, bm: 30 } },
    { id: 'c2', name: '철수부캐', playerId: 'p1', cooldown: 5, rates: { lucid: 30, will: 25, jhilla: 20 } },
    { id: 'c3', name: '철수삼캐', playerId: 'p1', cooldown: 10, rates: { lucid: 20 } },
    { id: 'c4', name: '영희본캐', playerId: 'p2', cooldown: 0, rates: { lucid: 50, will: 50, jhilla: 40, bm: 25 } },
    { id: 'c5', name: '영희부캐', playerId: 'p2', cooldown: 3, rates: { lucid: 35, will: 40, jhilla: 25, bm: 10 } },
    { id: 'c6', name: '민준본캐', playerId: 'p3', cooldown: 2, rates: { lucid: 70, will: 60, jhilla: 50, bm: 35 } },
    { id: 'c7', name: '민준부캐', playerId: 'p3', cooldown: 12, rates: { lucid: 25, will: 30, jhilla: 15 } },
    { id: 'c8', name: '서윤본캐', playerId: 'p4', cooldown: 1, rates: { lucid: 45, will: 45, jhilla: 35, bm: 20 } },
    { id: 'c9', name: '서윤부캐', playerId: 'p4', cooldown: 4, rates: { lucid: 30, will: 35, jhilla: 10, bm: 8 } },
    { id: 'c10', name: '서윤삼캐', playerId: 'p4', cooldown: 15, rates: { lucid: 15, will: 20 } },
  ],
};
