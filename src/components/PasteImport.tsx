import { useMemo, useState } from 'react';
import { AppData, Player } from '../types';
import { newId } from '../storage';
import { matchBosses, parseMaplescouter } from '../import/maplescouter';

type Update = (fn: (d: AppData) => AppData) => void;

/** 환산주스탯 「효율∙보스컷」 페이지를 붙여넣어 한 플레이어의 캐릭터 배율을 채운다 */
export function PasteImport({ data, player, update, onClose }: { data: AppData; player: Player; update: Update; onClose: () => void }) {
  const [source, setSource] = useState<{ html: string; kind: string } | null>(null);
  const [name, setName] = useState('');

  const parsed = useMemo(() => (source ? parseMaplescouter(source.html) : null), [source]);
  const match = useMemo(() => (parsed ? matchBosses(parsed.cards, data.bosses) : null), [parsed, data.bosses]);
  const existing = data.characters.find((c) => c.playerId === player.id && c.name === name.trim());

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    // 페이지에서 바로 복사하면 text/html에, 개발자도구에서 HTML을 복사하면 text/plain에 들어온다
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    const next = html ? { html, kind: '페이지 복사' } : { html: text, kind: 'HTML 텍스트' };
    setSource(next);
    setName(parseMaplescouter(next.html).characterName ?? '');
  };

  const apply = () => {
    if (!match) return;
    const n = name.trim();
    update((d) => {
      const old = d.characters.find((c) => c.playerId === player.id && c.name === n);
      if (old) {
        return { ...d, characters: d.characters.map((c) => (c.id === old.id ? { ...c, rates: { ...c.rates, ...match.rates } } : c)) };
      }
      return { ...d, characters: [...d.characters, { id: newId(), name: n, playerId: player.id, cooldown: 0, rates: match.rates }] };
    });
    onClose();
  };

  const kb = source ? Math.round(source.html.length / 1024) : 0;

  return (
    <div className="group-box">
      <div className="row between">
        <strong>환산주스탯에서 붙여넣기</strong>
        <button onClick={onClose}>닫기</button>
      </div>
      <p className="muted small">
        환산주스탯 「효율∙보스컷」 페이지에서 Ctrl+A, Ctrl+C 한 뒤 아래 칸에 붙여넣으세요. 데스티니·챔피언 카드는 읽지 않고, '[파티] 38%'는 38로 넣습니다. 쿨감은 직접 입력해야 합니다.
      </p>
      <textarea
        className="paste-box"
        value=""
        onChange={() => {}}
        onPaste={onPaste}
        placeholder={source ? `붙여넣음: ${source.kind}, ${kb} KB — 다시 붙여넣으면 바뀝니다` : '여기에 붙여넣기 (Ctrl+V)'}
      />

      {match && match.matched.length === 0 && (
        <p className="warn">
          보스 배율을 찾지 못했습니다. 페이지 글자만 복사됐을 수 있습니다. 개발자도구(F12)에서 &lt;body&gt;를 오른쪽 클릭 → Copy → Copy outerHTML 한 뒤 붙여넣어 보세요.
        </p>
      )}

      {match && match.matched.length > 0 && (
        <>
          <div className="row wrap">
            <label>
              캐릭터 이름 <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <span className={existing ? 'badge warn-badge' : 'badge ok'}>
              {existing ? `기존 캐릭터 '${existing.name}' 배율 갱신` : '새 캐릭터로 추가'}
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>보스</th>
                  <th>기존</th>
                  <th>새 값</th>
                </tr>
              </thead>
              <tbody>
                {match.matched.map(({ boss, rate }) => {
                  const before = existing?.rates[boss.id];
                  return (
                    <tr key={boss.id} className={boss.enabled ? undefined : 'off'}>
                      <td>
                        {boss.name}
                        {!boss.enabled && <span className="muted small"> (꺼짐)</span>}
                      </td>
                      <td className="muted">{before ?? '—'}</td>
                      <td>{before === rate ? <span className="muted">{rate}</span> : <strong>{rate}</strong>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {match.ignored.length > 0 && <p className="muted small">읽지 않은 카드: {match.ignored.map((c) => c.icon).join(', ')}</p>}
          {match.missingBoss.length > 0 && (
            <p className="warn small">
              보스 목록에 없는 보스(이름이 다름): {match.missingBoss.map((c) => `${c.bossName} ${c.rate}%`).join(', ')}
            </p>
          )}
          {match.unknown.length > 0 && <p className="warn small">인식 못한 아이콘: {match.unknown.map((c) => c.icon).join(', ')}</p>}
          <div className="row">
            <button className="primary" onClick={apply} disabled={!name.trim()}>
              적용 ({match.matched.length}개 보스)
            </button>
          </div>
        </>
      )}
    </div>
  );
}
