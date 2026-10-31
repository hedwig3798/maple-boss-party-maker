import { useState } from 'react';
import { AppData, Boss, MAX_PARTY_SIZE } from '../types';
import { newId } from '../storage';
import { buildTargets, validateBoss } from '../solver/targets';
import { NumberInput } from './NumberInput';

type Update = (fn: (d: AppData) => AppData) => void;

export function BossesPanel({ data, update }: { data: AppData; update: Update }) {
  const groupOf = new Map<string, string>();
  data.groups.forEach((g) => g.bossIds.forEach((b) => groupOf.set(b, g.id)));
  const groupTargets = new Map(buildTargets(data).filter((t) => t.isGroup).map((t) => [t.key, t]));
  const enabledBosses = data.bosses.filter((b) => b.enabled);
  const offCount = data.bosses.length - enabledBosses.length;
  // 켜진 보스가 하나도 없으면(처음 방문) 꺼진 보스까지 펼쳐서 시작
  const [showOff, setShowOff] = useState(enabledBosses.length === 0);
  const visibleBosses = showOff ? data.bosses : enabledBosses;

  const setBoss = (id: string, patch: Partial<Boss>) =>
    update((d) => ({ ...d, bosses: d.bosses.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
  const addBoss = () =>
    update((d) => ({
      ...d,
      bosses: [...d.bosses, { id: newId(), name: '', minSize: 1, maxSize: MAX_PARTY_SIZE, rateThreshold: 100, cooldownThreshold: 10, enabled: true }],
    }));
  const removeBoss = (id: string) => {
    const b = data.bosses.find((x) => x.id === id);
    const n = data.characters.filter((c) => c.rates[id] !== undefined).length;
    if (!confirm(`'${b?.name || '(이름 없음)'}' 보스를 삭제할까요?${n ? ` 캐릭터 ${n}개의 배율 입력도 지워집니다.` : ''}`)) return;
    update((d) => ({
      ...d,
      bosses: d.bosses.filter((x) => x.id !== id),
      groups: d.groups.map((g) => ({ ...g, bossIds: g.bossIds.filter((x) => x !== id) })),
      characters: d.characters.map((c) => {
        if (c.rates[id] === undefined) return c;
        const rates = { ...c.rates };
        delete rates[id];
        return { ...c, rates };
      }),
    }));
  };
  const addGroup = () =>
    update((d) => ({ ...d, groups: [...d.groups, { id: newId(), name: `그룹 ${d.groups.length + 1}`, bossIds: [] }] }));
  const toggleGroupBoss = (groupId: string, bossId: string, on: boolean) =>
    update((d) => ({
      ...d,
      groups: d.groups.map((g) =>
        g.id === groupId
          ? { ...g, bossIds: on ? [...g.bossIds, bossId] : g.bossIds.filter((x) => x !== bossId) }
          : g,
      ),
    }));

  return (
    <div className="stack">
      <section className="card">
        <div className="row between">
          <h2>
            보스 <small className="muted">사용 {enabledBosses.length} / {data.bosses.length}</small>
          </h2>
          <div className="row">
            {offCount > 0 && (
              <button onClick={() => setShowOff((v) => !v)}>{showOff ? '꺼진 보스 숨기기' : `꺼진 보스 보기 (${offCount})`}</button>
            )}
            <button className="primary" onClick={addBoss}>
              보스 추가
            </button>
          </div>
        </div>
        <p className="muted">가는 보스만 체크하세요. 꺼진 보스는 캐릭터 배율 칸·그룹·계산에서 빠지며, 입력해 둔 배율은 남아 있습니다.</p>
        {data.bosses.length === 0 ? (
          <p className="muted">보스가 없습니다.</p>
        ) : visibleBosses.length === 0 ? (
          <p className="muted">켜진 보스가 없습니다. '꺼진 보스 보기'를 눌러 가는 보스를 체크하세요.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>사용</th>
                  <th>보스</th>
                  <th>최소 인원</th>
                  <th>최대 인원</th>
                  <th>배율 기준치(%)</th>
                  <th>쿨감 기준치(초)</th>
                  <th>그룹</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleBosses.map((b) => {
                  const err = validateBoss(b);
                  const g = data.groups.find((x) => x.id === groupOf.get(b.id));
                  return (
                    <tr key={b.id} className={b.enabled ? '' : 'off'}>
                      <td>
                        <input type="checkbox" className="toggle" title="이 보스 사용" checked={b.enabled} onChange={(e) => setBoss(b.id, { enabled: e.target.checked })} />
                      </td>
                      <td>
                        <input className="boss-name" value={b.name} placeholder="보스 이름" onChange={(e) => setBoss(b.id, { name: e.target.value })} />
                        {err && <div className="error">{err}</div>}
                      </td>
                      <td>
                        <NumberInput className="num" value={b.minSize} min={1} step={1} onChange={(v) => setBoss(b.id, { minSize: v ?? 1 })} />
                      </td>
                      <td>
                        <NumberInput className="num" value={b.maxSize} min={1} step={1} onChange={(v) => setBoss(b.id, { maxSize: v ?? MAX_PARTY_SIZE })} />
                      </td>
                      <td>
                        <NumberInput className="num" value={b.rateThreshold} min={0} onChange={(v) => setBoss(b.id, { rateThreshold: v ?? 0 })} />
                      </td>
                      <td>
                        <NumberInput className="num" value={b.cooldownThreshold} min={0} onChange={(v) => setBoss(b.id, { cooldownThreshold: v ?? 0 })} />
                      </td>
                      <td className="muted">{g ? g.name : '단독'}</td>
                      <td>
                        <button className="icon danger" title="보스 삭제" onClick={() => removeBoss(b.id)}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="row between">
          <h2>보스 그룹</h2>
          <button onClick={addGroup} disabled={enabledBosses.length < 2}>
            그룹 추가
          </button>
        </div>
        <p className="muted">
          켜진 보스끼리만 묶을 수 있습니다. 묶인 보스는 같은 파티로 함께 갑니다. 인원 범위·쿨감 기준치는 가장 엄격한 값을 쓰고, 배율 기준치는 보스마다 각각 만족해야 합니다.
        </p>
        {data.groups.map((g) => {
          const t = groupTargets.get(`group:${g.id}`);
          return (
            <div className="group-box" key={g.id}>
              <div className="row between">
                <input
                  className="title-input"
                  value={g.name}
                  onChange={(e) =>
                    update((d) => ({ ...d, groups: d.groups.map((x) => (x.id === g.id ? { ...x, name: e.target.value } : x)) }))
                  }
                />
                <button
                  className="danger"
                  onClick={() => update((d) => ({ ...d, groups: d.groups.filter((x) => x.id !== g.id) }))}
                >
                  그룹 삭제
                </button>
              </div>
              <div className="chips">
                {enabledBosses.map((b) => {
                  const owner = groupOf.get(b.id);
                  const inThis = owner === g.id;
                  const disabled = !!owner && !inThis;
                  return (
                    <label key={b.id} className={`chip ${inThis ? 'on' : ''} ${disabled ? 'disabled' : ''}`} title={disabled ? '다른 그룹에 속한 보스' : ''}>
                      <input type="checkbox" checked={inThis} disabled={disabled} onChange={(e) => toggleGroupBoss(g.id, b.id, e.target.checked)} />
                      {b.name || '(이름 없음)'}
                    </label>
                  );
                })}
              </div>
              {t ? (
                t.error ? (
                  <div className="error">{t.error}</div>
                ) : (
                  <div className="muted">
                    인원 {t.minSize}~{t.maxSize}명 · 쿨감 범위 ≤ {t.cooldownThreshold}초 · 배율 기준 {t.bosses.map((b) => `${b.name} ${b.threshold}%`).join(', ')}
                  </div>
                )
              ) : (
                <div className="muted">보스를 선택하세요.</div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
