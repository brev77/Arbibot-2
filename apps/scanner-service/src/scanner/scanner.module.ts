import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  ScannerFindingEntity,
  ScannerInstanceStatusEntity,
} from '@arbibot/persistence';
import { AuditClientService } from '@arbibot/nest-platform';

import { ScannerConfigService } from './scanner-config.service';
import { ScannerDedupService } from './scanner-dedup.service';
import { ScannerFilterService } from './scanner-filter.service';
import { ScannerFindingsService } from './scanner-findings.service';
import { ScannerPipelineService } from './scanner-pipeline.service';
import { ScannerPoolService } from './scanner-pool.service';
import { ScannerRpcService } from './scanner-rpc.service';
import { ScannerSpreadService } from './scanner-spread.service';
import { ScannerVolumeService } from './scanner-volume.service';
import { ScannerWorkerService } from './scanner-worker.service';
import { ScannerController } from './scanner.controller';

/**
 * Scanner module (S1-1 / S1-3 / S1-4).
 *
 * Wires the config loader, the read-only RPC provider manager, the idle worker, and the
 * repositories for the two scanner-owned tables (single-writer: scanner-service). HTTP API
 * controllers arrive in S1-7.
 *
 * ScannerRpcService is exported so the local HealthModule can inject it for `GET /health/rpc`.
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
  providers: [ScannerConfigService, ScannerRpcService, ScannerPoolService, ScannerVolumeService, ScannerSpreadService, ScannerFilterService, ScannerDedupService, ScannerPipelineService, ScannerWorkerService, ScannerFindingsService, AuditClientService],
  controllers: [ScannerController],
  exports: [ScannerConfigService, ScannerRpcService, ScannerPoolService, ScannerVolumeService],
})
export class ScannerModule {}
