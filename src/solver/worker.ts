/// <reference lib="webworker" />
import { AppData } from '../types';
import { solveAll } from './solveAll';
import { TargetResult } from './solve';

export type WorkerRequest = { data: AppData; timeLimitMs: number };
export type WorkerResponse =
  | { type: 'progress'; done: number; total: number; result: TargetResult }
  | { type: 'done'; results: TargetResult[] };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const results = solveAll(e.data.data, e.data.timeLimitMs, (done, total, result) => {
    (self as DedicatedWorkerGlobalScope).postMessage({ type: 'progress', done, total, result } satisfies WorkerResponse);
  });
  (self as DedicatedWorkerGlobalScope).postMessage({ type: 'done', results } satisfies WorkerResponse);
};
