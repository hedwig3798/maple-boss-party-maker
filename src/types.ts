export interface Player {
  id: string;
  name: string;
}

export interface Character {
  id: string;
  name: string;
  playerId: string;
  /** 쿨타임 감소(초) */
  cooldown: number;
  /** 보스 id → 배율(%). 키가 없으면 해당 보스에 참여 불가 */
  rates: Record<string, number>;
}

export interface Boss {
  id: string;
  name: string;
  minSize: number;
  maxSize: number;
  /** 배율 기준치(%) */
  rateThreshold: number;
  /** 쿨감 기준치(초) */
  cooldownThreshold: number;
}

export interface BossGroup {
  id: string;
  name: string;
  bossIds: string[];
}

export interface AppData {
  players: Player[];
  characters: Character[];
  bosses: Boss[];
  groups: BossGroup[];
}

export const MAX_PARTY_SIZE = 6;
