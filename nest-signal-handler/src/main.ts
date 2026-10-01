import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // 有効化しないと Nest はシグナルを購読せず、ライフサイクルフックが呼ばれないまま Node のデフォルト動作で終了する
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`listening on ${await app.getUrl()} (pid=${process.pid})`, 'Bootstrap');
}

bootstrap();
