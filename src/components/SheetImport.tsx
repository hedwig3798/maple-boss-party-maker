import { useMemo, useState } from 'react';
import { AppData } from '../types';
import { applySheet, parseSheet } from '../import/sheet';

type Update = (fn: (d: AppData) => AppData) => void;

/** 엑셀 표(이름 | 보스 배율… | 플레이어)를 붙여넣어 플레이어·캐릭터를 한 번에 넣는다 */
export function SheetImport({ data, update, onClose }: { data: AppData; update: Update; onClose: () => void }) {
  const [text, setText] = useState('');
  const sheet = useMemo(() => (text ? parseSheet(text, data.bosses) : null), [text, data.bosses]);
  const bossCols = sheet?.columns.filter((c) => c.role === 'boss' && c.boss) ?? [];
  const ignored = sheet?.columns.filter((c) => c.role === 'ignore') ?? [];
  const skipped = sheet?.rows.reduce((n, r) => n + Object.keys(r.skipped).length, 0) ?? 0;

  const byName = new Map(data.characters.map((c) => [c.name.trim(), c]));
  const playerName = new Map(data.players.map((p) => [p.id, p.name]));
  const newPlayers = sheet ? [...new Set(sheet.rows.map((r) => r.player))].filter((n) => !data.players.some((p) => p.name.trim() === n)) : [];

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    setText(e.clipboardData.getData('text/plain'));
  };

  const apply = () => {
    if (!sheet) return;
    update((d) => applySheet(d, sheet));
    onClose();
  };

  return (
    <div className="group-box">
      <div className="row between">
        <strong>엑셀 표 붙여넣기</strong>
        <button onClick={onClose}>닫기</button>
      </div>
      <p className="muted small">
        형식: 이름 | 보스 배율 … | 플레이어. 첫 줄은 제목(보스 이름, 예: 하드발드·노말 림보)이고 마지막 열이 플레이어입니다. 숫자가 아닌 칸은 무시하고,
        이미 있는 캐릭터는 표에 숫자가 있는 보스의 배율만 바꿉니다. 쿨감은 직접 입력해야 합니다.
      </p>
      <textarea
        className="paste-box"
        value=""
        onChange={() => {}}
        onPaste={onPaste}
        placeholder={sheet ? `붙여넣음: ${sheet.rows.length}줄 — 다시 붙여넣으면 바뀝니다` : '엑셀에서 제목 줄까지 선택해 복사한 뒤 여기에 붙여넣기 (Ctrl+V)'}
      />

      {sheet && bossCols.length === 0 && <p className="warn">보스 열을 찾지 못했습니다. 첫 줄 제목이 보스 이름(예: 하드발드, 노말 림보)인지 확인하세요.</p>}

      {sheet && bossCols.length > 0 && (
        <>
          <p className="small">
            보스:{' '}
            {bossCols.map((c, i) => (
              <span key={i}>
                {i > 0 && ', '}
                {c.header} → <strong>{c.boss!.name}</strong>
                {!c.boss!.enabled && <span className="muted"> (켜짐으로 바뀜)</span>}
              </span>
            ))}
          </p>
          {ignored.length > 0 && (
            <p className="muted small">무시한 열: {ignored.map((c) => `${c.header || '(제목 없음)'} — ${c.note}`).join(', ')}</p>
          )}
          {skipped > 0 && <p className="muted small">숫자가 아니어서 무시한 칸 {skipped}개 (노란색)</p>}
          {sheet.droppedRows > 0 && <p className="warn small">이름이나 플레이어가 비어 읽지 않은 줄: {sheet.droppedRows}개</p>}
          {newPlayers.length > 0 && <p className="small">새 플레이어: {newPlayers.join(', ')}</p>}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>캐릭터</th>
                  <th>플레이어</th>
                  <th />
                  {bossCols.map((c, i) => (
                    <th key={i}>{c.boss!.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.map((r, i) => {
                  const old = byName.get(r.name);
                  const moved = old && playerName.get(old.playerId)?.trim() !== r.player;
                  return (
                    <tr key={i}>
                      <td>{r.name}</td>
                      <td>{r.player}</td>
                      <td>
                        {old ? (
                          <span className="badge warn-badge" title={moved ? `소속: ${playerName.get(old.playerId)} → ${r.player}` : undefined}>
                            {moved ? '갱신·소속 변경' : '갱신'}
                          </span>
                        ) : (
                          <span className="badge ok">새 캐릭터</span>
                        )}
                      </td>
                      {bossCols.map((c, j) => {
                        const v = r.rates[c.boss!.id];
                        const before = old?.rates[c.boss!.id];
                        if (v !== undefined)
                          return <td key={j}>{old && before !== v ? <strong title={`기존 ${before ?? '—'}`}>{v}</strong> : v}</td>;
                        const raw = r.skipped[c.boss!.id];
                        return (
                          <td key={j} className={raw ? 'skipped-cell' : 'muted'} title={raw ? `무시: ${raw}` : undefined}>
                            {raw || (before ?? '—')}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="row">
            <button className="primary" onClick={apply} disabled={sheet.rows.length === 0}>
              적용 (캐릭터 {sheet.rows.length}개)
            </button>
          </div>
        </>
      )}
    </div>
  );
}

