import { AppData } from '../types';
import { bossKind } from '../bossFamily';
import { buildTargets, Target } from './targets';
import { hasRate, solveTarget, TargetResult } from './solve';

/**
 * 계산 순서: 같은 보스의 높은 난이도가 들어간 대상을 먼저.
 * 그룹끼리 순서가 꼬이면(A는 하드 카링+노말 세렌, B는 노말 카링+하드 세렌) 원래 순서가 앞선 쪽을 먼저.
 */
export function orderTargets(targets: Target[]): Target[] {
  const kinds = targets.map((t) => t.bosses.map((b) => bossKind(b.name)));
  const before = (a: number, b: number) =>
    kinds[a].some((x) => kinds[b].some((y) => x.family === y.family && x.rank < y.rank));
  const left = targets.map((_, i) => i);
  const order: Target[] = [];
  while (left.length) {
    const pos = Math.max(0, left.findIndex((i) => !left.some((j) => j !== i && before(j, i))));
    order.push(targets[left[pos]]);
    left.splice(pos, 1);
  }
  return order;
}

export function solveAll(
  data: AppData,
  timeLimitMs: number,
  onProgress?: (done: number, total: number, result: TargetResult) => void,
): TargetResult[] {
  // 소속 플레이어가 없는 캐릭터는 계산에서 제외
  const playerIds = new Set(data.players.map((p) => p.id));
  const chars = data.characters.filter((c) => playerIds.has(c.playerId));
  const targets = orderTargets(buildTargets(data));
  /** 보스(난이도를 뗀 이름) → 이미 어떤 난이도에 배정된 캐릭터 */
  const takenByFamily = new Map<string, Set<string>>();
  return targets.map((t, i) => {
    const families = [...new Set(t.bosses.map((b) => bossKind(b.name).family))];
    const taken = new Set(families.flatMap((f) => [...(takenByFamily.get(f) ?? [])]));
    const r = solveTarget(t, chars.filter((c) => !taken.has(c.id)), timeLimitMs);
    for (const c of chars) {
      if (!taken.has(c.id)) continue;
      const canJoin = t.bosses.every((b) => hasRate(c, b.id));
      r.unassigned.push({ characterId: c.id, reason: canJoin ? 'OTHER_DIFFICULTY' : 'NO_RATE' });
    }
    for (const f of families) {
      const set = takenByFamily.get(f) ?? new Set<string>();
      r.parties.forEach((p) => p.memberIds.forEach((id) => set.add(id)));
      takenByFamily.set(f, set);
    }
    onProgress?.(i + 1, targets.length, r);
    return r;
  });
}
