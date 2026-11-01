import { useState } from 'react';
import { AppData } from '../types';
import { Reason, REASON_LABEL, TargetResult } from '../solver/solve';
import { crossDifficultyConflicts, evaluateParty, EvaluatedParty, moveMember } from '../solver/manual';
import { NumberInput } from './NumberInput';
import { SummaryTables } from './SummaryTables';

export interface RunState {
  running: boolean;
  done: number;
  total: number;
  results: TargetResult[];
  /** 계산에 사용한 입력 (이름 표시용, 변경 감지용) */
  snapshot: AppData | null;
  /** 결과 key → 손으로 고친 파티 구성원. 없으면 계산 결과 그대로 */
  edits: Record<string, string[][]>;
}

interface Props {
  run: RunState;
  stale: boolean;
  timeLimitSec: number;
  setTimeLimitSec: (v: number) => void;
  weakRatio: number;
  setWeakRatio: (v: number) => void;
  onRun: () => void;
  onCancel: () => void;
  /** parties가 undefined면 계산 결과로 되돌린다 */
  setEdit: (key: string, parties: string[][] | undefined) => void;
}

/** 손으로 파티에서 뺀 캐릭터 */
type PoolReason = Reason | 'MANUAL';
const POOL_LABEL: Record<PoolReason, string> = { ...REASON_LABEL, MANUAL: '직접 뺌' };
const REASON_ORDER: PoolReason[] = ['MANUAL', 'OTHER_DIFFICULTY', 'SOLO', 'TOO_WEAK', 'EXCLUDED', 'NO_COMBINATION', 'COOLDOWN', 'SAME_PLAYER', 'NOT_ENOUGH_MEMBERS', 'NO_RATE'];
const pct = (x: number) => `${Math.round(x * 10) / 10}%`;
const fmt = (x: number, d = 3) => x.toFixed(d);
type Drag = { key: string; id: string };

export function ResultsPanel({ run, stale, timeLimitSec, setTimeLimitSec, weakRatio, setWeakRatio, onRun, onCancel, setEdit }: Props) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const snap = run.snapshot;
  const charById = new Map(snap?.characters.map((c) => [c.id, c]) ?? []);
  const playerName = new Map(snap?.players.map((p) => [p.id, p.name]) ?? []);
  const label = (id: string) => {
    const c = charById.get(id);
    return c ? `${c.name || '(이름 없음)'}` : id;
  };
  const owner = (id: string) => playerName.get(charById.get(id)?.playerId ?? '') ?? '';

  const partiesOf = (r: TargetResult) => run.edits[r.key] ?? r.parties.map((p) => p.memberIds);
  const evaluated = new Map<string, EvaluatedParty[]>(run.results.map((r) => [r.key, partiesOf(r).map((ms) => evaluateParty(r, ms, charById))]));
  const conflicts = crossDifficultyConflicts(run.results, partiesOf);

  /** 드래그 중인 캐릭터를 같은 결과 안의 to 위치로 옮기는 드롭 대상. to: 파티 번호, 새 파티(parties.length), 미배정(-1) */
  const dropZone = (r: TargetResult, to: number) => {
    const zone = `${r.key}:${to}`;
    const active = drag?.key === r.key;
    return {
      className: active ? (over === zone ? 'drop-target over' : 'drop-target') : undefined,
      onDragOver: (e: React.DragEvent) => {
        if (!active) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (over !== zone) setOver(zone);
      },
      onDragLeave: (e: React.DragEvent) => {
        if (over === zone && !e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
      },
      onDrop: (e: React.DragEvent) => {
        if (!active) return;
        e.preventDefault();
        setEdit(r.key, moveMember(partiesOf(r), drag.id, to));
        setDrag(null);
        setOver(null);
      },
    };
  };
  const draggable = (r: TargetResult, id: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      setDrag({ key: r.key, id });
    },
    onDragEnd: () => {
      setDrag(null);
      setOver(null);
    },
  });

  return (
    <div className="stack">
      <section className="card">
        <div className="row between wrap">
          <div className="row">
            <label className="row">
              보스당 시간 제한
              <NumberInput className="num" value={timeLimitSec} min={0.5} onChange={(v) => setTimeLimitSec(v && v > 0 ? v : 3)} />
              초
            </label>
            <label className="row" title="배율이 기준값(배율 기준치 ÷ 최대 인원) × 이 배수보다 낮은 캐릭터는 제외합니다. 0이면 제외하지 않습니다.">
              배율 너무 낮음 기준
              <NumberInput
                className="num"
                value={weakRatio}
                min={0}
                step={0.05}
                // 빈칸·음수는 무시하고 이전 값을 유지
                onChange={(v) => v !== undefined && v >= 0 && setWeakRatio(v)}
              />
              배
            </label>
          </div>
          <div className="row">
            {run.running ? (
              <>
                <span className="muted">
                  계산 중… {run.done}/{run.total}
                </span>
                <button className="danger" onClick={onCancel}>
                  중단
                </button>
              </>
            ) : (
              <button className="primary big" onClick={onRun}>
                파티 계산하기
              </button>
            )}
          </div>
        </div>
        {stale && !run.running && <div className="warn">입력이 바뀌었습니다. 다시 계산하세요.</div>}
        <p className="muted small">
          혼자 기준치를 채우는(솔로 가능) 캐릭터와 배율이 기준값(기준치 ÷ 최대 인원)의 {weakRatio}배 미만인 캐릭터는 빼고, ① 작은 파티부터 최대한 많이 ② 파티 안 배율 편차(최고 − 최저, 기준치 대비)가 가장 큰 파티의 편차 최소 ③ 편차 합 최소 순으로 짭니다. 시간 제한 안에 최적을 증명하지 못하면 그때까지 찾은 가장 좋은 결과를 보여줍니다.
        </p>
        {run.results.length > 0 && <p className="muted small">계산이 끝나면 캐릭터를 끌어서 다른 파티·새 파티·미배정으로 옮길 수 있습니다. 같은 보스(그룹) 안에서만 옮겨집니다.</p>}
      </section>

      {run.results.map((r) => {
        const edited = !!run.edits[r.key];
        const parties = evaluated.get(r.key)!;
        const conflict = conflicts.get(r.key)!;
        const assigned = new Set(parties.flatMap((p) => p.memberIds));
        // 미배정 = 이 결과에 나온 모든 캐릭터 중 지금 파티에 없는 캐릭터
        const pool: { id: string; reason: PoolReason }[] = [
          ...r.parties.flatMap((p) => p.memberIds).map((id) => ({ id, reason: 'MANUAL' as PoolReason })),
          ...r.unassigned.map((u) => ({ id: u.characterId, reason: u.reason as PoolReason })),
        ].filter((u) => !assigned.has(u.id));
        const byReason = new Map<PoolReason, string[]>();
        pool.forEach((u) => byReason.set(u.reason, [...(byReason.get(u.reason) ?? []), u.id]));
        const maxSpread = parties.reduce((a, p) => Math.max(a, p.spread), 0);
        const canEdit = !run.running && !r.error;
        return (
          <section className="card" key={r.key}>
            <div className="row between wrap">
              <h2>
                {r.name} {r.isGroup && <span className="tag">그룹: {r.bossNames.join(', ')}</span>}
              </h2>
              {!r.error && (
                <div className="row wrap">
                  <span className="badge">파티 {parties.length}개</span>
                  {parties.length > 0 && <span className="badge">최대 편차 {fmt(maxSpread)}</span>}
                  {edited ? (
                    <>
                      <span className="badge warn-badge">직접 수정함</span>
                      <button className="icon" onClick={() => setEdit(r.key, undefined)}>
                        원래대로
                      </button>
                    </>
                  ) : r.optimal ? (
                    <span className="badge ok">최적</span>
                  ) : r.countOptimal ? (
                    <span className="badge warn-badge" title="파티 인원 구성은 최적임이 확정, 편차는 시간 제한으로 최적 미확정">
                      인원 구성 확정 · 편차 미확정
                    </span>
                  ) : (
                    <span className="badge warn-badge">시간 초과 · 최적 미확정</span>
                  )}
                  <span className="muted small">{(r.elapsedMs / 1000).toFixed(2)}초</span>
                </div>
              )}
            </div>
            {r.error ? (
              <div className="error">{r.error}</div>
            ) : (
              <>
                <div className="muted small">
                  인원 {r.minSize}~{r.maxSize}명 · 쿨감 범위 ≤ {r.cooldownThreshold}초 · 배율 기준{' '}
                  {r.bossNames.map((b, i) => `${b} ${r.thresholds[i]}%`).join(', ')}
                </div>
                {parties.length === 0 && !(canEdit && drag?.key === r.key) ? (
                  <p className="muted">만들 수 있는 파티가 없습니다.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="result">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>구성원</th>
                          <th>배율 합</th>
                          <th>배율 편차</th>
                          <th>여유율</th>
                          <th>쿨감 범위</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parties.map((p, i) => (
                          <tr key={i} {...(canEdit ? dropZone(r, i) : {})}>
                            <td>{i + 1}</td>
                            <td>
                              <div className="members">
                                {p.memberIds.map((id) => (
                                  <span
                                    className={`member${canEdit ? ' grab' : ''}${conflict.has(id) ? ' bad' : ''}${drag?.id === id && drag.key === r.key ? ' dragging' : ''}`}
                                    key={id}
                                    {...(canEdit ? draggable(r, id) : {})}
                                  >
                                    {label(id)}
                                    <small>
                                      {owner(id)} · {r.bossIds.map((b) => pct(charById.get(id)?.rates[b] ?? 0)).join('/')}
                                    </small>
                                  </span>
                                ))}
                              </div>
                              {(p.warnings.length > 0 || p.memberIds.some((id) => conflict.has(id))) && (
                                <ul className="party-warn">
                                  {p.warnings.map((w) => (
                                    <li key={w}>{w}</li>
                                  ))}
                                  {p.memberIds
                                    .filter((id) => conflict.has(id))
                                    .map((id) => (
                                      <li key={id}>
                                        {label(id)}: {conflict.get(id)!.join(', ')}에도 배정됨
                                      </li>
                                    ))}
                                </ul>
                              )}
                            </td>
                            <td>
                              {p.rateSums.map((s, k) => (
                                <div key={k}>
                                  {r.isGroup && <small className="muted">{r.bossNames[k]} </small>}
                                  {pct(s)}
                                </div>
                              ))}
                            </td>
                            <td>
                              <strong>{fmt(p.spread)}</strong>
                            </td>
                            <td>{fmt(p.slack)}</td>
                            <td>
                              {p.cooldownMin}~{p.cooldownMax}초 <small className="muted">(폭 {Math.round((p.cooldownMax - p.cooldownMin) * 100) / 100})</small>
                            </td>
                          </tr>
                        ))}
                        {canEdit && drag?.key === r.key && (
                          <tr {...dropZone(r, parties.length)}>
                            <td colSpan={6} className="muted new-party">
                              + 여기에 놓으면 새 파티
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
                {(pool.length > 0 || (canEdit && drag?.key === r.key)) && (
                  <div {...(canEdit ? dropZone(r, -1) : {})}>
                    <details className="unassigned" open={pool.some((u) => u.reason !== 'NO_RATE' && u.reason !== 'OTHER_DIFFICULTY')}>
                      <summary>
                        미배정 캐릭터 {pool.length}개{canEdit && drag?.key === r.key && ' — 여기에 놓으면 파티에서 뺌'}
                      </summary>
                      <ul>
                        {REASON_ORDER.filter((reason) => byReason.has(reason)).map((reason) => (
                          <li key={reason}>
                            <span className={`reason r-${reason}`}>{POOL_LABEL[reason]}</span>
                            <span className="members inline">
                              {byReason.get(reason)!.map((id) => (
                                <span className={`member${canEdit ? ' grab' : ''}`} key={id} {...(canEdit ? draggable(r, id) : {})}>
                                  {label(id)}
                                  <small>{owner(id)}</small>
                                </span>
                              ))}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </div>
                )}
              </>
            )}
          </section>
        );
      })}
      {!run.running && run.results.length === 0 && <p className="muted">아직 계산 결과가 없습니다.</p>}
      {!run.running && run.results.length > 0 && (
        <SummaryTables
          tables={run.results
            .filter((r) => !r.error && evaluated.get(r.key)!.length > 0)
            .map((r) => ({
              title: r.name,
              columns: evaluated.get(r.key)!.map((p) => ({
                header: `${r.isGroup ? `${r.bossNames[p.tightest]} ` : ''}${pct(p.rateSums[p.tightest])}`,
                members: p.memberIds.map(label),
              })),
            }))}
        />
      )}
    </div>
  );
}
