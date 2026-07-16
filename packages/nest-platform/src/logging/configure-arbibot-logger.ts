import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { PinoLoggerService } from './pino-logger.service';

/**
 * Install the Arbibot pino-backed `LoggerService` on a NestJS app (D4-C-1-LOGGING).
 *
 * One-line replacement for the default Nest console logger in every service `main.ts`:
 * ```ts
 * const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
 * configureArbibotLogger(app, 'risk-service');
 * ```
 *
 * The logger is constructed eagerly (not via DI) because Nest's `useLogger` must be
 * set before the app bootstraps providers — and every service wants the same shape.
 * `serviceName` is also what `installMetricsOnFastify` uses, so keep them identical.
 *
 * Pretty-printing is auto-enabled outside production (or when `ARBIBOT_LOG_PRETTY=true`);
 * production emits NDJSON for Loki/Promtail ingestion.
 */
export function configureArbibotLogger(
  app: NestFastifyApplication,
  serviceName: string,
): void {
  app.useLogger(new PinoLoggerService({ serviceName }));
}
