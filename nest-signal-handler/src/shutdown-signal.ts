import { BeforeApplicationShutdown, Injectable } from '@nestjs/common';

@Injectable()
export class ShutdownSignal implements BeforeApplicationShutdown {
  private readonly controller = new AbortController();

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  // HTTP サーバーのクローズは処理中リクエストの完了を待つため、その前段の本フックで中断を通知する
  beforeApplicationShutdown(signal?: string) {
    this.controller.abort(signal);
  }
}
