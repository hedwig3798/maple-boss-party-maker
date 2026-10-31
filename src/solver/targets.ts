import { AppData, Boss, MAX_PARTY_SIZE } from '../types';

/** 독립적으로 파티를 계산하는 단위: 그룹에 속하지 않은 보스 하나, 또는 보스 그룹 하나 */
export interface Target {
  key: string;
  name: string;
  isGroup: boolean;
  bosses: { id: string; name: string; threshold: number }[];
  minSize: number;
  maxSize: number;
  cooldownThreshold: number;
  /** 설정 오류가 있으면 계산하지 않는다 */
  error?: string;
}

export function validateBoss(b: Boss): string | undefined {
  if (!b.name.trim()) return '보스 이름이 비어 있습니다';
  if (!Number.isInteger(b.minSize) || b.minSize < 1) return '최소 인원은 1 이상의 정수여야 합니다';
  if (!Number.isInteger(b.maxSize) || b.maxSize > MAX_PARTY_SIZE) return `최대 인원은 ${MAX_PARTY_SIZE} 이하의 정수여야 합니다`;
  if (b.minSize > b.maxSize) return '최소 인원이 최대 인원보다 큽니다';
  if (!(b.rateThreshold > 0)) return '배율 기준치는 0보다 커야 합니다';
  if (!(b.cooldownThreshold >= 0)) return '쿨감 기준치는 0 이상이어야 합니다';
  return undefined;
}

export function buildTargets(data: AppData): Target[] {
  const bossById = new Map(data.bosses.filter((b) => b.enabled).map((b) => [b.id, b]));
  const grouped = new Set<string>();
  const targets: Target[] = [];

  for (const g of data.groups) {
    const bosses = g.bossIds.map((id) => bossById.get(id)).filter((b): b is Boss => !!b);
    if (bosses.length === 0) continue;
    bosses.forEach((b) => grouped.add(b.id));
    const minSize = Math.max(...bosses.map((b) => b.minSize));
    const maxSize = Math.min(...bosses.map((b) => b.maxSize));
    let error: string | undefined;
    for (const b of bosses) {
      const e = validateBoss(b);
      if (e) {
        error = `${b.name}: ${e}`;
        break;
      }
    }
    if (!error && minSize > maxSize) {
      error = `그룹 인원 범위가 비어 있습니다 (최소 ${minSize} > 최대 ${maxSize})`;
    }
    targets.push({
      key: `group:${g.id}`,
      name: g.name || '(이름 없는 그룹)',
      isGroup: true,
      bosses: bosses.map((b) => ({ id: b.id, name: b.name, threshold: b.rateThreshold })),
      minSize,
      maxSize,
      cooldownThreshold: Math.min(...bosses.map((b) => b.cooldownThreshold)),
      error,
    });
  }

  for (const b of data.bosses) {
    if (!b.enabled || grouped.has(b.id)) continue;
    targets.push({
      key: `boss:${b.id}`,
      name: b.name || '(이름 없는 보스)',
      isGroup: false,
      bosses: [{ id: b.id, name: b.name, threshold: b.rateThreshold }],
      minSize: b.minSize,
      maxSize: b.maxSize,
      cooldownThreshold: b.cooldownThreshold,
      error: validateBoss(b),
    });
  }
  return targets;
}
