import { Controller, Get, Logger, Query, ServiceUnavailableException } from '@nestjs/common';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';
import { Worker } from 'node:worker_threads';
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
}
