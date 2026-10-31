import { AppData, Boss, BossGroup, Character, Player } from './types';

const KEY = 'maple-boss-party-maker:v1';

export const EMPTY_DATA: AppData = { players: [], characters: [], bosses: [], groups: [] };

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch {
    // 저장소 접근 불가 또는 손상된 데이터 → 빈 데이터로 시작
  }
  return EMPTY_DATA;
}

export function saveData(data: AppData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // 저장 실패는 무시 (사생활 보호 모드 등)
  }
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** 불러온 JSON을 검사하고 정리한다. 형식이 맞지 않으면 예외 */
export function normalize(input: unknown): AppData {
  if (!input || typeof input !== 'object') throw new Error('JSON 객체가 아닙니다');
  const o = input as Record<string, unknown>;
  if (!['players', 'characters', 'bosses', 'groups'].some((k) => Array.isArray(o[k]))) {
    throw new Error('players / characters / bosses / groups 항목이 없습니다');
  }
  const players: Player[] = arr(o.players).map((p) => ({ id: str(p.id) || newId(), name: str(p.name) }));
  const bosses: Boss[] = arr(o.bosses).map((b) => ({
    id: str(b.id) || newId(),
    name: str(b.name),
    minSize: num(b.minSize, 1),
    maxSize: num(b.maxSize, 6),
    rateThreshold: num(b.rateThreshold, 100),
    cooldownThreshold: num(b.cooldownThreshold, 0),
  }));
  const bossIds = new Set(bosses.map((b) => b.id));
  const characters: Character[] = arr(o.characters).map((c) => {
    const rates: Record<string, number> = {};
    if (c.rates && typeof c.rates === 'object') {
      for (const [k, v] of Object.entries(c.rates)) if (bossIds.has(k) && typeof v === 'number' && Number.isFinite(v)) rates[k] = v;
    }
    return { id: str(c.id) || newId(), name: str(c.name), playerId: str(c.playerId), cooldown: num(c.cooldown, 0), rates };
  });
  // 한 보스는 최대 한 그룹에만
  const taken = new Set<string>();
  const groups: BossGroup[] = arr(o.groups).map((g) => ({
    id: str(g.id) || newId(),
    name: str(g.name),
    bossIds: arr(g.bossIds)
      .map(str)
      .filter((id) => bossIds.has(id) && !taken.has(id) && (taken.add(id), true)),
  }));
  return { players, characters, bosses, groups };
}

export function downloadJson(data: AppData) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  a.href = url;
  a.download = `party-maker-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
