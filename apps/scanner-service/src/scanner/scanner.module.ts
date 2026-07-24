import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  ScannerFindingEntity,
  ScannerInstanceStatusEntity,
} from '@arbibot/persistence';
import { AuditClientService } from '@arbibot/nest-platform';

import { ScannerConfigService } from './scanner-config.service';
import { ScannerWorkerService } from './scanner-worker.service';

/**
 * Scanner module (S1-1 / S1-3).
 *
 * Wires the config loader, the idle worker, and the repositories for the two scanner-owned
 * tables (single-writer: scanner-service). HTTP API controllers arrive in S1-7.
 *
 * AuditClientService is provided so that future config mutations / status writes can emit
 * audit entries (e.g. the operator force-refresh / manual-run endpoints).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ScannerInstanceStatusEntity,
      ScannerFindingEntity,
    ]),
  ],
  providers: [ScannerConfigService, ScannerWorkerService, AuditClientService],
  exports: [ScannerConfigService],
})
export class ScannerModule {}
