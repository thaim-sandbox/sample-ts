import { parentPort, workerData } from 'node:worker_threads';
import { busyLoop } from './busy-loop.js';

export type CooperativeResult = { cancelled: boolean; iterations: number; elapsedMs: number };

const { ms, cancelBuffer } = workerData as { ms: number; cancelBuffer: SharedArrayBuffer };
const cancelFlag = new Int32Array(cancelBuffer);
const startedAt = Date.now();
let iterations = 0;
let cancelled = false;
// 中断の通知は postMessage ではなく共有メモリで受け取る。同期ループ中はメッセージのイベントを処理できないため
while (Date.now() - startedAt < ms) {
  if (Atomics.load(cancelFlag, 0) === 1) {
    cancelled = true;
    break;
  }
  iterations += busyLoop(10);
}
// 中断時の後始末はここに書く。このサンプルでは中断時点の途中経過をメインスレッドに返す
const result: CooperativeResult = { cancelled, iterations, elapsedMs: Date.now() - startedAt };
parentPort!.postMessage(result);
