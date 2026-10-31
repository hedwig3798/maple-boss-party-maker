import { AppData } from '../types';
import { buildTargets } from './targets';
import { solveTarget, TargetResult } from './solve';

export function solveAll(
  data: AppData,
  timeLimitMs: number,
  onProgress?: (done: number, total: number, result: TargetResult) => void,
): TargetResult[] {
  // 소속 플레이어가 없는 캐릭터는 계산에서 제외
  const playerIds = new Set(data.players.map((p) => p.id));
  const chars = data.characters.filter((c) => playerIds.has(c.playerId));
  const targets = buildTargets(data);
  return targets.map((t, i) => {
    const r = solveTarget(t, chars, timeLimitMs);
    onProgress?.(i + 1, targets.length, r);
    return r;
  });
}
