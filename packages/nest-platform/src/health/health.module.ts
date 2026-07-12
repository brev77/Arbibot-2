import { Global, Module } from '@nestjs/common';

import { HealthController } from './health.controller';

/**
 * Reusable health module for all Arbibot Nest services (D4-A-5-PROBES).
 *
 * `@Global()` so services drop it once into their root `imports` and the
 * `/health`, `/health/live`, `/health/ready` endpoints are live. The
 * DataSource and REDIS_CLIENT providers are optional — when a service has
 * registered TypeORM / a redis client, the readiness probe pings them;
 * otherwise it degrades to liveness-only.
 *
 * Mirrors the `AuditClientModule` pattern (static @Global module).
 */
@Global()
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
