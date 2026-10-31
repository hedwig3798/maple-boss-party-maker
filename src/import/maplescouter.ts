import { Boss } from '../types';

/**
 * 환산주스탯(maplescouter.com) 「효율∙보스컷」 페이지 HTML에서 보스별 배율을 읽는다.
 * 보스는 아이콘 파일명(/bossIcon/hard_bardrix.png)으로 알아내고, 같은 카드 안의 "49.18%"를 배율로 쓴다.
 * 사이트의 Tailwind 클래스 이름은 자주 바뀌므로 쓰지 않는다.
 */

const DIFFICULTY: Record<string, string> = {
  easy: '이지',
  normal: '노말',
  hard: '하드',
  chaos: '카오스',
  extreme: '익스트림',
};

/** 데스티니·챔피언 카드는 일반 난이도와 기준이 달라 읽지 않는다 */
const IGNORED_DIFFICULTY = new Set(['destiny', 'champion']);

const BOSS: Record<string, string> = {
  jupiter: '유피테르',
  bardrix: '발드릭스',
  adversary: '대적자',
  limbo: '림보',
  kaling: '카링',
  kalos: '칼로스',
  lotus: '스우',
  bellona: '벨로나',
  maleficStar: '흉성',
  seren: '세렌',
  blackMage: '검은마법사',
  // 아래는 '내 기준보기' 화면에 없어 아직 실제 파일명으로 확인하지 못했다
  dunkel: '듄켈',
  dusk: '더스크',
  jinHilla: '진힐라',
  will: '윌',
  slime: '슬라임',
  lucid: '루시드',
  damien: '데미안',
};

const RATE_RE = /^(\[파티\]\s*)?([\d,]+(?:\.\d+)?)%$/;
const ICON_SELECTOR = 'img[src*="/bossIcon/"]';

export interface ParsedCard {
  /** 아이콘 파일명(확장자 제외), 예: hard_bardrix */
  icon: string;
  /** 앱 보스 이름으로 바꾼 것. 모르는 아이콘이면 undefined */
  bossName?: string;
  rate?: number;
  ignored: boolean;
}

export interface ParseResult {
  characterName?: string;
  cards: ParsedCard[];
}

export function iconToBossName(icon: string): string | undefined {
  const i = icon.indexOf('_');
  if (i < 0) return undefined;
  const diff = DIFFICULTY[icon.slice(0, i)];
  const boss = BOSS[icon.slice(i + 1)];
  return diff && boss ? `${diff} ${boss}` : undefined;
}

/** 아이콘을 하나만 포함하는 가장 바깥 조상 = 그 보스의 카드 */
function cardOf(img: Element): Element {
  let card = img;
  for (let p = img.parentElement; p && p.querySelectorAll(ICON_SELECTOR).length === 1; p = p.parentElement) card = p;
  return card;
}

function rateIn(card: Element): number | undefined {
  let rate: number | undefined;
  for (const el of Array.from(card.querySelectorAll('*'))) {
    if (el.children.length > 0) continue;
    const m = RATE_RE.exec((el.textContent ?? '').trim());
    if (m) rate = Number(m[2].replace(/,/g, ''));
  }
  return rate;
}

export function parseMaplescouter(html: string): ParseResult {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  let characterName: string | undefined;
  for (const h of Array.from(doc.querySelectorAll('h4'))) {
    const m = /^Lv\.\d+\s+(.+)\/[^/]+$/.exec((h.textContent ?? '').trim());
    if (m) {
      characterName = m[1].trim();
      break;
    }
  }

  const cards: ParsedCard[] = [];
  const seen = new Set<string>();
  for (const img of Array.from(doc.querySelectorAll(ICON_SELECTOR))) {
    const m = /\/bossIcon\/([^/?#]+)\.\w+/.exec(img.getAttribute('src') ?? '');
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    const icon = m[1];
    const ignored = IGNORED_DIFFICULTY.has(icon.split('_')[0]);
    cards.push({ icon, bossName: iconToBossName(icon), rate: rateIn(cardOf(img)), ignored });
  }
  return { characterName, cards };
}

export interface MatchResult {
  /** 앱 보스 id → 배율 */
  rates: Record<string, number>;
  matched: { boss: Boss; rate: number }[];
  ignored: ParsedCard[];
  /** 이름은 알지만 앱 보스 목록에 같은 이름이 없음 */
  missingBoss: ParsedCard[];
  /** 처음 보는 아이콘이거나 배율을 못 읽음 */
  unknown: ParsedCard[];
}

/** 띄어쓰기 차이(진 힐라 / 진힐라)는 무시하고 이름으로 맞춘다 */
const key = (s: string) => s.replace(/\s+/g, '');

export function matchBosses(cards: ParsedCard[], bosses: Boss[]): MatchResult {
  const byName = new Map(bosses.map((b) => [key(b.name), b]));
  const r: MatchResult = { rates: {}, matched: [], ignored: [], missingBoss: [], unknown: [] };
  for (const c of cards) {
    if (c.ignored) r.ignored.push(c);
    else if (!c.bossName || c.rate === undefined) r.unknown.push(c);
    else {
      const boss = byName.get(key(c.bossName));
      if (!boss) r.missingBoss.push(c);
      else {
        r.rates[boss.id] = c.rate;
        r.matched.push({ boss, rate: c.rate });
      }
    }
  }
  return r;
}
