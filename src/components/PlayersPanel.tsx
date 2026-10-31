import { useState } from 'react';
import { AppData, Character } from '../types';
import { newId } from '../storage';
import { NumberInput } from './NumberInput';
import { PasteImport } from './PasteImport';

type Update = (fn: (d: AppData) => AppData) => void;

export function PlayersPanel({ data, update }: { data: AppData; update: Update }) {
  const [newName, setNewName] = useState('');
  /** 붙여넣기 칸을 연 플레이어 */
  const [pastingId, setPastingId] = useState<string | null>(null);
  const bosses = data.bosses.filter((b) => b.enabled);

  const addPlayer = () => {
    const name = newName.trim();
    if (!name) return;
    update((d) => ({ ...d, players: [...d.players, { id: newId(), name }] }));
    setNewName('');
  };
  const removePlayer = (id: string) => {
    const p = data.players.find((x) => x.id === id);
    const n = data.characters.filter((c) => c.playerId === id).length;
    if (n > 0 && !confirm(`'${p?.name}' 플레이어와 캐릭터 ${n}개를 함께 삭제할까요?`)) return;
    update((d) => ({
      ...d,
      players: d.players.filter((x) => x.id !== id),
      characters: d.characters.filter((c) => c.playerId !== id),
    }));
  };
  const setChar = (id: string, patch: Partial<Character>) =>
    update((d) => ({ ...d, characters: d.characters.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const setRate = (c: Character, bossId: string, v: number | undefined) => {
    const rates = { ...c.rates };
    if (v === undefined) delete rates[bossId];
    else rates[bossId] = v;
    setChar(c.id, { rates });
  };
  const addCharacter = (playerId: string) =>
    update((d) => ({
      ...d,
      characters: [...d.characters, { id: newId(), name: '', playerId, cooldown: 0, rates: {} }],
    }));
  const removeCharacter = (id: string) =>
    update((d) => ({ ...d, characters: d.characters.filter((c) => c.id !== id) }));

  return (
    <div className="stack">
      <section className="card">
        <h2>플레이어</h2>
        <div className="row">
          <input
            value={newName}
            placeholder="플레이어 이름"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPlayer()}
          />
          <button className="primary" onClick={addPlayer} disabled={!newName.trim()}>
            플레이어 추가
          </button>
        </div>
        {data.players.length === 0 && <p className="muted">플레이어를 먼저 추가하세요.</p>}
      </section>

      {data.players.map((p) => {
        const chars = data.characters.filter((c) => c.playerId === p.id);
        return (
          <section className="card" key={p.id}>
            <div className="row between">
              <input
                className="title-input"
                value={p.name}
                onChange={(e) =>
                  update((d) => ({
                    ...d,
                    players: d.players.map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x)),
                  }))
                }
              />
              <div className="row">
                <button onClick={() => addCharacter(p.id)}>+ 캐릭터</button>
                <button onClick={() => setPastingId(pastingId === p.id ? null : p.id)}>붙여넣기</button>
                <button className="danger" onClick={() => removePlayer(p.id)}>
                  플레이어 삭제
                </button>
              </div>
            </div>
            {pastingId === p.id && <PasteImport data={data} player={p} update={update} onClose={() => setPastingId(null)} />}
            {chars.length === 0 ? (
              <p className="muted">캐릭터가 없습니다.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>캐릭터</th>
                      <th>소속</th>
                      <th title="쿨타임 감소(초)">쿨감(초)</th>
                      {bosses.map((b) => (
                        <th key={b.id} title={`${b.name} 배율(%) — 비우면 미참여`}>
                          {b.name || '(이름 없음)'} %
                        </th>
                      ))}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {chars.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <input value={c.name} placeholder="이름" onChange={(e) => setChar(c.id, { name: e.target.value })} />
                        </td>
                        <td>
                          <select value={c.playerId} onChange={(e) => setChar(c.id, { playerId: e.target.value })}>
                            {data.players.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <NumberInput className="num" value={c.cooldown} min={0} onChange={(v) => setChar(c.id, { cooldown: v ?? 0 })} />
                        </td>
                        {bosses.map((b) => (
                          <td key={b.id}>
                            <NumberInput className="num" value={c.rates[b.id]} min={0} placeholder="—" onChange={(v) => setRate(c, b.id, v)} />
                          </td>
                        ))}
                        <td>
                          <button className="icon danger" title="캐릭터 삭제" onClick={() => removeCharacter(c.id)}>
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
      {data.players.length > 0 && bosses.length === 0 && (
        <p className="muted">'보스 · 그룹' 탭에서 가는 보스를 체크하면 캐릭터별 배율 칸이 생깁니다. 배율 칸을 비우면 그 보스에는 참여하지 않습니다.</p>
      )}
    </div>
  );
}
