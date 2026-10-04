import { parentPort, workerData } from 'node:worker_threads';

const ms = workerData as number;
const startedAt = Date.now();
let iterations = 0;
// イベントループを譲らない同期処理として、指定時間 CPU を使い続ける
while (Date.now() - startedAt < ms) {
  iterations++;
}
parentPort!.postMessage(iterations);
