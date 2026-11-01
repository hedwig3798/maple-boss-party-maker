import { useState } from 'react';

export interface SummaryTable {
  title: string;
  /** 파티 하나 = 한 열 */
  columns: { header: string; members: string[] }[];
}

const FONT = "'Pretendard', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif";
const PAD = 20;
const ROW_H = 32;
const TITLE_H = 34;
const GAP = 24;
const MIN_COL_W = 110;
const SCALE = 2;
// 이미지는 디스코드·카톡에 붙여 넣으므로 화면 테마와 상관없이 밝은 색으로
const COLOR = { bg: '#ffffff', text: '#1d2130', line: '#d5d9e3', head: '#fbe7d5', headText: '#9a4a0c', title: '#1d2130' };

/** 표들을 세로로 이어 붙인 PNG 한 장 */
function renderPng(tables: SummaryTable[]): Promise<Blob> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const cellFont = `14px ${FONT}`;
  const headFont = `bold 14px ${FONT}`;
  const titleFont = `bold 17px ${FONT}`;

  const layout = tables.map((t) => {
    const widths = t.columns.map((c) => {
      ctx.font = headFont;
      let w = ctx.measureText(c.header).width;
      ctx.font = cellFont;
      for (const m of c.members) w = Math.max(w, ctx.measureText(m).width);
      return Math.max(MIN_COL_W, Math.ceil(w) + 24);
    });
    const rows = Math.max(...t.columns.map((c) => c.members.length));
    return { t, widths, rows, width: widths.reduce((a, b) => a + b, 0), height: TITLE_H + ROW_H * (rows + 1) };
  });
  ctx.font = titleFont;
  const width = Math.max(...layout.map((l) => Math.max(l.width, ctx.measureText(l.t.title).width))) + PAD * 2;
  const height = layout.reduce((a, l) => a + l.height, 0) + GAP * (layout.length - 1) + PAD * 2;

  canvas.width = Math.ceil(width * SCALE);
  canvas.height = Math.ceil(height * SCALE);
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = 'middle';

  let y = PAD;
  for (const { t, widths, rows, width: tw } of layout) {
    ctx.font = titleFont;
    ctx.fillStyle = COLOR.title;
    ctx.textAlign = 'left';
    ctx.fillText(t.title, PAD, y + TITLE_H / 2 - 3);
    y += TITLE_H;
    ctx.fillStyle = COLOR.head;
    ctx.fillRect(PAD, y, tw, ROW_H);
    ctx.textAlign = 'center';
    let x = PAD;
    t.columns.forEach((c, i) => {
      const cx = x + widths[i] / 2;
      ctx.font = headFont;
      ctx.fillStyle = COLOR.headText;
      ctx.fillText(c.header, cx, y + ROW_H / 2);
      ctx.font = cellFont;
      ctx.fillStyle = COLOR.text;
      c.members.forEach((m, r) => ctx.fillText(m, cx, y + ROW_H * (r + 1.5)));
      x += widths[i];
    });
    // 격자
    ctx.strokeStyle = COLOR.line;
    ctx.lineWidth = 1;
    const h = ROW_H * (rows + 1);
    ctx.strokeRect(PAD + 0.5, y + 0.5, tw - 1, h - 1);
    for (let r = 1; r <= rows; r++) {
      ctx.beginPath();
      ctx.moveTo(PAD, y + ROW_H * r + 0.5);
      ctx.lineTo(PAD + tw, y + ROW_H * r + 0.5);
      ctx.stroke();
    }
    x = PAD;
    for (const w of widths.slice(0, -1)) {
      x += w;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, y);
      ctx.lineTo(x + 0.5, y + h);
      ctx.stroke();
    }
    y += h + GAP;
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지 생성 실패'))), 'image/png'));
}

/** 클립보드에 이미지 복사. 브라우저가 막으면 파일로 저장 */
async function copyPng(tables: SummaryTable[], fileName: string): Promise<string> {
  const blob = renderPng(tables);
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return '이미지를 복사했습니다. 붙여넣기(Ctrl+V) 하세요.';
  } catch {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await blob);
    a.download = `${fileName}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
    return '클립보드 복사가 막혀 PNG 파일로 저장했습니다.';
  }
}

export function SummaryTables({ tables }: { tables: SummaryTable[] }) {
  const [msg, setMsg] = useState('');
  const copy = async (ts: SummaryTable[], name: string) => setMsg(await copyPng(ts, name));
  if (tables.length === 0) return null;
  return (
    <section className="card">
      <div className="row between wrap">
        <h2>파티 표</h2>
        <div className="row wrap">
          {msg && <span className="muted small">{msg}</span>}
          <button className="primary" onClick={() => copy(tables, '파티 표')}>
            전체 이미지 복사
          </button>
        </div>
      </div>
      {tables.map((t) => {
        const rows = Math.max(...t.columns.map((c) => c.members.length));
        return (
          <div key={t.title} className="summary">
            <div className="row between">
              <h3>{t.title}</h3>
              <button className="icon" onClick={() => copy([t], t.title)}>
                이미지 복사
              </button>
            </div>
            <div className="table-wrap">
              <table className="summary-table">
                <thead>
                  <tr>
                    {t.columns.map((c, i) => (
                      <th key={i}>{c.header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: rows }, (_, r) => (
                    <tr key={r}>
                      {t.columns.map((c, i) => (
                        <td key={i}>{c.members[r] ?? ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </section>
  );
}
