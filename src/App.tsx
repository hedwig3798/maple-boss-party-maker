import { useEffect, useRef, useState } from 'react';
import { AppData } from './types';
import { DEFAULT_DATA, downloadJson, loadData, loadRun, normalize, saveData, saveRun } from './storage';
import { PlayersPanel } from './components/PlayersPanel';
import { BossesPanel } from './components/BossesPanel';
import { ResultsPanel, RunState } from './components/ResultsPanel';
import type { WorkerResponse } from './solver/worker';
// 인라인 워커: 배포용 HTML 한 파일(file://)에서도 별도 워커 파일 없이 돌아간다
import SolverWorker from './solver/worker.ts?worker&inline';

type Tab = 'players' | 'bosses' | 'results';
const TABS: [Tab, string][] = [
  ['players', '플레이어 · 캐릭터'],
  ['bosses', '보스 · 그룹'],
  ['results', '결과'],
];

export default function App() {
  const [initial] = useState(() => {
    const d = loadData();
    return { data: d, run: loadRun(d) };
  });
  const [data, setData] = useState<AppData>(initial.data);
  const [tab, setTab] = useState<Tab>('players');
  const [timeLimitSec, setTimeLimitSec] = useState(3);
  const [run, setRun] = useState<RunState>(() => {
    const saved = initial.run;
    return { running: false, done: 0, total: 0, results: saved?.results ?? [], snapshot: saved?.snapshot ?? null, edits: saved?.edits ?? {} };
  });
  const workerRef = useRef<Worker | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => saveData(data), [data]);
  // 계산 중에는 저장하지 않아, 도중에 창을 닫으면 직전 결과가 남는다
  useEffect(() => {
    if (!run.running) saveRun(run.snapshot ? { results: run.results, snapshot: run.snapshot, edits: run.edits } : null);
  }, [run.running, run.results, run.snapshot, run.edits]);
  useEffect(() => () => workerRef.current?.terminate(), []);

  const update = (fn: (d: AppData) => AppData) => setData(fn);
  const replaceData = (next: AppData, what: string) => {
    const hasData = data.players.length + data.characters.length + data.bosses.length > 0;
    if (hasData && !confirm(`현재 입력을 ${what}(으)로 덮어쓸까요?`)) return;
    setData(next);
    setRun({ running: false, done: 0, total: 0, results: [], snapshot: null, edits: {} });
  };

  const startRun = () => {
    if (Object.keys(run.edits).length > 0 && !confirm('손으로 고친 파티가 있습니다. 다시 계산하면 사라집니다. 계속할까요?')) return;
    workerRef.current?.terminate();
    const worker = new SolverWorker();
    workerRef.current = worker;
    const snapshot = data;
    setRun({ running: true, done: 0, total: 0, results: [], snapshot, edits: {} });
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
          <button onClick={() => downloadJson(data)}>JSON 내보내기</button>
          <button onClick={() => fileRef.current?.click()}>JSON 불러오기</button>
          <button className="danger" onClick={() => replaceData(DEFAULT_DATA, '기본 보스 목록')}>
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
            {key === 'bosses' && <small> {data.bosses.filter((b) => b.enabled).length}/{data.bosses.length}보스</small>}
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
            weakRatio={data.weakRatio}
            setWeakRatio={(weakRatio) => update((d) => ({ ...d, weakRatio }))}
            onRun={startRun}
            onCancel={cancelRun}
            setEdit={(key, parties) =>
              setRun((r) => {
                const edits = { ...r.edits };
                if (parties) edits[key] = parties;
                else delete edits[key];
                return { ...r, edits };
              })
            }
          />
        )}
      </main>
    </div>
  );
}
