import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleDestroy,
} from '@nestjs/common';

@Injectable()
export class ShutdownObserver
  implements OnModuleDestroy, BeforeApplicationShutdown, OnApplicationShutdown
{
  private readonly logger = new Logger(ShutdownObserver.name);

  onModuleDestroy() {
    this.logger.log('onModuleDestroy');
  }

  beforeApplicationShutdown(signal?: string) {
    this.logger.log(`beforeApplicationShutdown signal=${signal}`);
  }

  onApplicationShutdown(signal?: string) {
    this.logger.log(`onApplicationShutdown signal=${signal}`);
  }
}
