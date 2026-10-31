import { useEffect, useRef, useState } from 'react';
import { AppData } from './types';
import { downloadJson, EMPTY_DATA, loadData, normalize, saveData } from './storage';
import { SAMPLE_DATA } from './sample';
import { PlayersPanel } from './components/PlayersPanel';
import { BossesPanel } from './components/BossesPanel';
import { ResultsPanel, RunState } from './components/ResultsPanel';
import type { WorkerResponse } from './solver/worker';

type Tab = 'players' | 'bosses' | 'results';
const TABS: [Tab, string][] = [
  ['players', '플레이어 · 캐릭터'],
  ['bosses', '보스 · 그룹'],
  ['results', '결과'],
];

export default function App() {
  const [data, setData] = useState<AppData>(loadData);
  const [tab, setTab] = useState<Tab>('players');
  const [timeLimitSec, setTimeLimitSec] = useState(3);
  const [run, setRun] = useState<RunState>({ running: false, done: 0, total: 0, results: [], snapshot: null });
  const workerRef = useRef<Worker | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => saveData(data), [data]);
  useEffect(() => () => workerRef.current?.terminate(), []);

  const update = (fn: (d: AppData) => AppData) => setData(fn);
  const replaceData = (next: AppData, what: string) => {
    const hasData = data.players.length + data.characters.length + data.bosses.length > 0;
    if (hasData && !confirm(`현재 입력을 ${what}(으)로 덮어쓸까요?`)) return;
    setData(next);
    setRun({ running: false, done: 0, total: 0, results: [], snapshot: null });
  };

  const startRun = () => {
    workerRef.current?.terminate();
    const worker = new Worker(new URL('./solver/worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    const snapshot = data;
    setRun({ running: true, done: 0, total: 0, results: [], snapshot });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        setRun((r) => ({ ...r, done: msg.done, total: msg.total, results: [...r.results, msg.result] }));
      } else {
        setRun((r) => ({ ...r, running: false, results: msg.results }));
        worker.terminate();
        workerRef.current = null;
      }
    };
    worker.onerror = (e) => {
      alert(`계산 중 오류: ${e.message}`);
      setRun((r) => ({ ...r, running: false }));
    };
    worker.postMessage({ data: snapshot, timeLimitMs: timeLimitSec * 1000 });
  };
  const cancelRun = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setRun((r) => ({ ...r, running: false }));
  };

  const onImport = async (file: File) => {
    try {
      replaceData(normalize(JSON.parse(await file.text())), `'${file.name}'`);
    } catch (err) {
      alert(`불러오기 실패: ${(err as Error).message}`);
    }
  };

  const stale = !!run.snapshot && run.snapshot !== data;

  return (
    <div className="app">
      <header>
        <h1>메이플 파티 보스 메이커</h1>
        <div className="row wrap">
          <button onClick={() => replaceData(SAMPLE_DATA, '예시 데이터')}>예시 불러오기</button>
          <button onClick={() => downloadJson(data)}>JSON 내보내기</button>
          <button onClick={() => fileRef.current?.click()}>JSON 불러오기</button>
          <button className="danger" onClick={() => replaceData(EMPTY_DATA, '빈 데이터')}>
            전체 초기화
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = '';
            }}
          />
        </div>
      </header>
      <nav className="tabs">
        {TABS.map(([key, label]) => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            {label}
            {key === 'players' && <small> {data.players.length}명 / {data.characters.length}캐릭</small>}
            {key === 'bosses' && <small> {data.bosses.length}보스</small>}
          </button>
        ))}
      </nav>
      <main>
        {tab === 'players' && <PlayersPanel data={data} update={update} />}
        {tab === 'bosses' && <BossesPanel data={data} update={update} />}
        {tab === 'results' && (
          <ResultsPanel
            run={run}
            stale={stale}
            timeLimitSec={timeLimitSec}
            setTimeLimitSec={setTimeLimitSec}
            onRun={startRun}
            onCancel={cancelRun}
          />
        )}
      </main>
    </div>
  );
}
