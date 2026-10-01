import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { ShutdownObserver } from './shutdown-observer.js';
import { ShutdownSignal } from './shutdown-signal.js';

@Module({
  controllers: [AppController],
  providers: [ShutdownObserver, ShutdownSignal],
})
export class AppModule {}
