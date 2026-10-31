import { AppData } from '../types';
import { Reason, REASON_LABEL, TargetResult } from '../solver/solve';
import { NumberInput } from './NumberInput';

export interface RunState {
  running: boolean;
  done: number;
  total: number;
  results: TargetResult[];
  /** 계산에 사용한 입력 (이름 표시용, 변경 감지용) */
  snapshot: AppData | null;
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
}

const REASON_ORDER: Reason[] = ['OTHER_DIFFICULTY', 'SOLO', 'TOO_WEAK', 'EXCLUDED', 'NO_COMBINATION', 'COOLDOWN', 'SAME_PLAYER', 'NOT_ENOUGH_MEMBERS', 'NO_RATE'];
const pct = (x: number) => `${Math.round(x * 10) / 10}%`;
const fmt = (x: number, d = 3) => x.toFixed(d);

export function ResultsPanel({ run, stale, timeLimitSec, setTimeLimitSec, weakRatio, setWeakRatio, onRun, onCancel }: Props) {
  const snap = run.snapshot;
  const charName = new Map(snap?.characters.map((c) => [c.id, c]) ?? []);
  const playerName = new Map(snap?.players.map((p) => [p.id, p.name]) ?? []);
  const label = (id: string) => {
    const c = charName.get(id);
    return c ? `${c.name || '(이름 없음)'}` : id;
  };
  const owner = (id: string) => playerName.get(charName.get(id)?.playerId ?? '') ?? '';

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
      </section>

      {run.results.map((r) => {
        const byReason = new Map<Reason, string[]>();
        r.unassigned.forEach((u) => byReason.set(u.reason, [...(byReason.get(u.reason) ?? []), u.characterId]));
        return (
          <section className="card" key={r.key}>
            <div className="row between wrap">
              <h2>
                {r.name} {r.isGroup && <span className="tag">그룹: {r.bossNames.join(', ')}</span>}
              </h2>
              {!r.error && (
                <div className="row wrap">
                  <span className="badge">파티 {r.parties.length}개</span>
                  {r.parties.length > 0 && <span className="badge">최대 편차 {fmt(r.maxSpread)}</span>}
                  {r.optimal ? (
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
                {r.parties.length === 0 ? (
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
                        {r.parties.map((p, i) => (
                          <tr key={i}>
                            <td>{i + 1}</td>
                            <td>
                              <div className="members">
                                {p.memberIds.map((id) => (
                                  <span className="member" key={id}>
                                    {label(id)}
                                    <small>
                                      {owner(id)} · {r.bossIds.map((b) => pct(charName.get(id)?.rates[b] ?? 0)).join('/')}
                                    </small>
                                  </span>
                                ))}
                              </div>
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
                      </tbody>
                    </table>
                  </div>
                )}
                {r.unassigned.length > 0 && (
                  <details className="unassigned" open={r.unassigned.some((u) => u.reason !== 'NO_RATE' && u.reason !== 'OTHER_DIFFICULTY')}>
                    <summary>미배정 캐릭터 {r.unassigned.length}개</summary>
                    <ul>
                      {REASON_ORDER.filter((reason) => byReason.has(reason)).map((reason) => (
                        <li key={reason}>
                          <span className={`reason r-${reason}`}>{REASON_LABEL[reason]}</span>
                          {byReason.get(reason)!.map((id) => `${label(id)}(${owner(id)})`).join(', ')}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </section>
        );
      })}
      {!run.running && run.results.length === 0 && <p className="muted">아직 계산 결과가 없습니다.</p>}
    </div>
  );
}
