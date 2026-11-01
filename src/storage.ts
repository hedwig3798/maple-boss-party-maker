import { AppData, Boss, BossGroup, Character, DEFAULT_WEAK_RATIO, Player } from './types';
import { DEFAULT_BOSSES } from './defaultBosses';
import type { TargetResult } from './solver/solve';

const KEY = 'maple-boss-party-maker:v1';
const RUN_KEY = 'maple-boss-party-maker:result:v1';

/** 처음 방문·전체 초기화 시 상태: 플레이어·캐릭터는 비우고 보스는 기본 목록 */
export const DEFAULT_DATA: AppData = { players: [], characters: [], bosses: DEFAULT_BOSSES, groups: [], weakRatio: DEFAULT_WEAK_RATIO };

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
    // 저장소 접근 불가 또는 손상된 데이터 → 기본 데이터로 시작
  }
  return DEFAULT_DATA;
}

export function saveData(data: AppData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // 저장 실패는 무시 (사생활 보호 모드 등)
  }
}

export interface SavedRun {
  results: TargetResult[];
  snapshot: AppData;
  edits: Record<string, string[][]>;
}

/** 마지막 계산 결과(손으로 고친 파티 포함). 입력과 따로 저장해 브라우저를 다시 열어도 결과 화면이 남는다 */
export function loadRun(current: AppData): SavedRun | null {
  try {
    const raw = localStorage.getItem(RUN_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!Array.isArray(o.results) || !o.edits || typeof o.edits !== 'object') return null;
    const snapshot = normalize(o.snapshot);
    // 입력이 그대로면 같은 객체로 두어 '입력이 바뀌었습니다' 판정이 계산 직후와 같게
    return { results: o.results, edits: o.edits, snapshot: JSON.stringify(snapshot) === JSON.stringify(current) ? current : snapshot };
  } catch {
    return null;
  }
}

export function saveRun(run: SavedRun | null) {
  try {
    if (run && run.results.length > 0) localStorage.setItem(RUN_KEY, JSON.stringify(run));
    else localStorage.removeItem(RUN_KEY);
  } catch {
    // 저장 실패는 무시
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
    // 이 항목이 없던 예전 데이터는 켜진 것으로 본다
    enabled: b.enabled !== false,
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
  // 이 항목이 없던 예전 데이터는 기본값
  const weakRatio = num(o.weakRatio, DEFAULT_WEAK_RATIO);
  return { players, characters, bosses, groups, weakRatio: weakRatio >= 0 ? weakRatio : DEFAULT_WEAK_RATIO };
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
