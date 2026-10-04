// イベントループを譲らない同期処理として、指定時間 CPU を使い続ける
export function busyLoop(ms: number): number {
  const startedAt = Date.now();
  let iterations = 0;
  while (Date.now() - startedAt < ms) {
    iterations++;
  }
  return iterations;
}
