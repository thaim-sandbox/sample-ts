import { Controller, Get, Logger, Query, ServiceUnavailableException } from '@nestjs/common';
import { once } from 'node:events';
import { setImmediate, setTimeout } from 'node:timers/promises';
import { Worker } from 'node:worker_threads';
import { busyLoop } from './busy-loop.js';
import type { CooperativeResult } from './cpu-worker-cooperative.js';
import { ShutdownSignal } from './shutdown-signal.js';

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(private readonly shutdownSignal: ShutdownSignal) {}

  @Get()
  hello(): string {
    this.logger.log('GET /');
    return 'ok';
  }

  // 処理中リクエストがある状態で SIGTERM を送ったときの挙動を確認するため、応答を遅延させる
  @Get('sleep')
  async sleep(@Query('ms') ms = '5000'): Promise<string> {
    this.logger.log(`sleep start (${ms}ms)`);
    await setTimeout(Number(ms));
    this.logger.log('sleep end');
    return `slept ${ms}ms`;
  }

  @Get('cancellable-sleep')
  async cancellableSleep(@Query('ms') ms = '5000'): Promise<string> {
    this.logger.log(`cancellable sleep start (${ms}ms)`);
    const { signal } = this.shutdownSignal;
    try {
      await setTimeout(Number(ms), undefined, { signal });
    } catch (err) {
      if (!signal.aborted) throw err;
      this.logger.warn(`cancellable sleep cancelled by ${signal.reason}`);
      throw new ServiceUnavailableException(`cancelled by ${signal.reason}`);
    }
    this.logger.log('cancellable sleep end');
    return `slept ${ms}ms`;
  }

  // Worker スレッドで実行し中断時に強制終了する。同期的な CPU 処理をメインスレッドで動かすとイベントループを止め、SIGTERM のハンドラも動かせないため
  @Get('cpu-heavy')
  async cpuHeavy(@Query('ms') ms = '5000'): Promise<string> {
    this.logger.log(`cpu heavy start (${ms}ms)`);
    const { signal } = this.shutdownSignal;
    const worker = new Worker(new URL('./cpu-worker.js', import.meta.url), {
      workerData: Number(ms),
    });
    try {
      const [iterations] = (await once(worker, 'message', { signal })) as [number];
      this.logger.log(`cpu heavy end (${iterations} iterations)`);
      return `computed ${iterations} iterations in ${ms}ms`;
    } catch (err) {
      if (!signal.aborted) throw err;
      await worker.terminate();
      this.logger.warn(`cpu heavy cancelled by ${signal.reason} (worker terminated)`);
      throw new ServiceUnavailableException(`cancelled by ${signal.reason}`);
    }
  }

  // Worker に中断を通知して後始末させる。terminate() では Worker 内で処理を実行できないため。猶予内に終わらなければ cpu-heavy と同じく強制終了する
  @Get('cpu-heavy-cooperative')
  async cpuHeavyCooperative(@Query('ms') ms = '5000'): Promise<string> {
    this.logger.log(`cpu heavy cooperative start (${ms}ms)`);
    const { signal } = this.shutdownSignal;
    const cancelBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const worker = new Worker(new URL('./cpu-worker-cooperative.js', import.meta.url), {
      workerData: { ms: Number(ms), cancelBuffer },
    });
    const graceMs = 1000;
    const onAbort = () => {
      Atomics.store(new Int32Array(cancelBuffer), 0, 1);
      void setTimeout(graceMs, undefined, { ref: false }).then(() => worker.terminate());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    let result: CooperativeResult | undefined;
    try {
      // 強制終了した Worker はメッセージを送らないため、exit も待つ
      [result] = await Promise.race([
        once(worker, 'message') as Promise<[CooperativeResult]>,
        once(worker, 'exit').then(() => [undefined] as const),
      ]);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
    if (!result) {
      this.logger.warn(`cpu heavy cooperative cancelled by ${signal.reason} (worker terminated after ${graceMs}ms grace)`);
      throw new ServiceUnavailableException(`cancelled by ${signal.reason}`);
    }
    if (result.cancelled) {
      this.logger.warn(
        `cpu heavy cooperative cancelled by ${signal.reason} after ${result.elapsedMs}ms (${result.iterations} iterations, cleaned up by worker)`,
      );
      throw new ServiceUnavailableException(`cancelled by ${signal.reason}`);
    }
    this.logger.log(`cpu heavy cooperative end (${result.iterations} iterations)`);
    return `computed ${result.iterations} iterations in ${ms}ms`;
  }

  // Worker を使わず、10ms ごとにイベントループへ処理を譲る。譲った間に SIGTERM のハンドラを動かし、中断を受け付けるため
  @Get('cpu-heavy-chunked')
  async cpuHeavyChunked(@Query('ms') ms = '5000'): Promise<string> {
    this.logger.log(`cpu heavy chunked start (${ms}ms)`);
    const { signal } = this.shutdownSignal;
    const startedAt = Date.now();
    let iterations = 0;
    try {
      while (Date.now() - startedAt < Number(ms)) {
        iterations += busyLoop(10);
        await setImmediate(undefined, { signal });
      }
    } catch (err) {
      if (!signal.aborted) throw err;
      this.logger.warn(
        `cpu heavy chunked cancelled by ${signal.reason} after ${Date.now() - startedAt}ms (${iterations} iterations)`,
      );
      throw new ServiceUnavailableException(`cancelled by ${signal.reason}`);
    }
    this.logger.log(`cpu heavy chunked end (${iterations} iterations)`);
    return `computed ${iterations} iterations in ${ms}ms`;
  }

  // cpu-heavy との比較用に、Worker を使わずメインスレッドで実行する。ループ中は SIGTERM のハンドラも動けず、中断できないことを確認するため
  @Get('cpu-heavy-blocking')
  cpuHeavyBlocking(@Query('ms') ms = '5000'): string {
    this.logger.log(`cpu heavy blocking start (${ms}ms)`);
    const iterations = busyLoop(Number(ms));
    this.logger.log(`cpu heavy blocking end (${iterations} iterations)`);
    return `computed ${iterations} iterations in ${ms}ms`;
  }
}
