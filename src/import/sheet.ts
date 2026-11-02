import { AppData, Boss } from '../types';
import { DIFFICULTIES, bossKind } from '../bossFamily';
import { newId } from '../storage';

/**
 * 엑셀에서 복사한 표(탭 구분)를 읽는다.
 * 형식: 이름 | 보스 1 배율 | 보스 2 배율 | ... | 플레이어
 * - 첫 줄은 제목. 제목이 '이름'인 열이 캐릭터 이름(없으면 첫 열), 마지막 열이 플레이어
 * - 그 사이 열은 제목을 보스 이름으로 맞춘다(예: 하드발드 → 하드 발드릭스). 맞는 보스가 없는 열은 무시
 * - 숫자가 아닌 칸(빈 칸, '포스30' 같은 메모)은 무시
 */

export interface SheetColumn {
  header: string;
  role: 'name' | 'player' | 'boss' | 'ignore';
  boss?: Boss;
  /** role이 ignore인 이유 */
  note?: string;
}

export interface SheetRow {
  name: string;
  player: string;
  /** 보스 id → 배율 */
  rates: Record<string, number>;
  /** 보스 id → 숫자가 아니어서 무시한 칸의 글자 */
  skipped: Record<string, string>;
}

export interface SheetResult {
  columns: SheetColumn[];
  rows: SheetRow[];
  /** 이름이나 플레이어가 비어 읽지 않은 줄 수 */
  droppedRows: number;
}

const key = (s: string) => s.replace(/\s+/g, '');

/** 자주 쓰는 줄임말 중 앞부분으로 찾을 수 없는 것 */
const ALIAS: Record<string, string> = { 검마: '검은마법사' };

/** 표 제목을 보스로 맞춘다. 정확한 이름 → '난이도 + 보스 이름 앞부분' 순으로 찾고, 후보가 하나일 때만 맞춘다 */
export function matchBossHeader(header: string, bosses: Boss[]): Boss | Boss[] | undefined {
  const h = key(header);
  if (!h) return undefined;
  const exact = bosses.find((b) => key(b.name) === h);
  if (exact) return exact;
  const d = DIFFICULTIES.find((x) => h.startsWith(x) && h.length > x.length);
  if (!d) return undefined;
  const rest = h.slice(d.length);
  const family = ALIAS[rest] ?? rest;
  const found = bosses.filter((b) => {
    const k = bossKind(b.name);
    return k.difficulty === d && key(k.family).startsWith(family);
  });
  return found.length === 1 ? found[0] : found.length > 1 ? found : undefined;
}

/** '1,234.5', '49.18%' 도 숫자로 읽는다. 숫자가 아니면 undefined */
export function parseRate(cell: string): number | undefined {
  const t = cell.trim().replace(/,/g, '').replace(/%$/, '');
  if (!/^\d+(\.\d+)?$/.test(t)) return undefined;
  return Number(t);
}

export function parseSheet(text: string, bosses: Boss[]): SheetResult {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => l.trim());
  if (lines.length === 0) return { columns: [], rows: [], droppedRows: 0 };

  const headers = lines[0].split('\t').map((h) => h.trim());
  const playerIdx = headers.length - 1;
  const named = headers.findIndex((h) => key(h) === '이름');
  const nameIdx = named >= 0 && named < playerIdx ? named : 0;

  const columns: SheetColumn[] = headers.map((header, i) => {
    if (i === nameIdx) return { header, role: 'name' };
    if (i === playerIdx) return { header, role: 'player' };
    if (i < nameIdx) return { header, role: 'ignore', note: '이름 열 앞' };
    const m = matchBossHeader(header, bosses);
    if (!m) return { header, role: 'ignore', note: '맞는 보스 없음' };
    if (Array.isArray(m)) return { header, role: 'ignore', note: `보스 후보 여럿: ${m.map((b) => b.name).join(', ')}` };
    return { header, role: 'boss', boss: m };
  });

  const rows: SheetRow[] = [];
  let droppedRows = 0;
  for (const line of lines.slice(1)) {
    const cells = line.split('\t');
    const name = (cells[nameIdx] ?? '').trim();
    const player = (cells[playerIdx] ?? '').trim();
    if (!name || !player) {
      droppedRows++;
      continue;
    }
    const row: SheetRow = { name, player, rates: {}, skipped: {} };
    columns.forEach((col, i) => {
      if (col.role !== 'boss' || !col.boss) return;
      const cell = (cells[i] ?? '').trim();
      if (!cell) return;
      const rate = parseRate(cell);
      if (rate === undefined) row.skipped[col.boss.id] = cell;
      else row.rates[col.boss.id] = rate;
    });
    rows.push(row);
  }
  return { columns, rows, droppedRows };
}

/**
 * 읽은 표를 데이터에 합친다.
 * - 플레이어는 이름으로 찾고 없으면 만든다
 * - 캐릭터는 이름으로 찾아(캐릭터 이름은 서버에서 하나뿐) 소속을 표의 플레이어로 맞추고 표의 배율만 덮어쓴다. 없으면 만든다(쿨감 0)
 * - 무시한 칸의 보스 배율은 그대로 둔다
 * - 표에 나온 보스는 켠다
 */
export function applySheet(d: AppData, sheet: SheetResult): AppData {
  const players = [...d.players];
  const characters = [...d.characters];
  const playerId = (name: string) => {
    let p = players.find((x) => x.name.trim() === name);
    if (!p) {
      p = { id: newId(), name };
      players.push(p);
    }
    return p.id;
  };
  for (const row of sheet.rows) {
    const pid = playerId(row.player);
    const i = characters.findIndex((c) => c.name.trim() === row.name);
    if (i >= 0) characters[i] = { ...characters[i], playerId: pid, rates: { ...characters[i].rates, ...row.rates } };
    else characters.push({ id: newId(), name: row.name, playerId: pid, cooldown: 0, rates: { ...row.rates } });
  }
  const used = new Set(sheet.columns.flatMap((c) => (c.role === 'boss' && c.boss ? [c.boss.id] : [])));
  const bosses = d.bosses.map((b) => (used.has(b.id) && !b.enabled ? { ...b, enabled: true } : b));
  return { ...d, players, characters, bosses };
}
