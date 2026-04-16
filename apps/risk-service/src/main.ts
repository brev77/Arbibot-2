import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';

import {
  applyArbibotHttpSecurity,
  correlationIdPreHandler,
  installMetricsOnFastify,
  startOpenTelemetryNodeSdkIfConfigured,
} from '@arbibot/nest-platform';

import { AppModule } from './app.module';

startOpenTelemetryNodeSdkIfConfigured({ serviceName: 'risk-service' });

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  await applyArbibotHttpSecurity(app);
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('preHandler', correlationIdPreHandler);
  if (process.env.METRICS_ENABLED !== 'false') {
    installMetricsOnFastify(fastify);
  }
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
}

bootstrap().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
