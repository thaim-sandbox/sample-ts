import { Controller, Get, Logger, Query, ServiceUnavailableException } from '@nestjs/common';
import { setTimeout } from 'node:timers/promises';
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
}
