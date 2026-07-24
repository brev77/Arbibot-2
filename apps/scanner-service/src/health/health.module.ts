import { Module } from '@nestjs/common';

import { ScannerModule } from '../scanner/scanner.module';
import { HealthController } from './health.controller';

/**
 * Local health module for scanner-service (S1-4-RPC).
 *
 * Imports ScannerModule so the HealthController can inject ScannerRpcService. Composed in
 * AppModule ALONGSIDE the shared `HealthModule` from `@arbibot/nest-platform` (which owns
 * `GET /health`, `GET /health/live`, `GET /health/ready`). This module only adds the
 * service-specific `GET /health/rpc` probe.
 *
 * Pattern mirrors apps/market-intake-service/src/health/health.module.ts.
 */
@Module({
  imports: [ScannerModule],
  controllers: [HealthController],
})
export class HealthModule {}
