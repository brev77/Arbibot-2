import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ReconciliationMismatchEntity } from '@arbibot/persistence';

import { MismatchesController } from './mismatches.controller';
import { MismatchesService } from './mismatches.service';
import { ReconciliationDetectorCronWorker } from './reconciliation-detector-cron.worker';

@Module({
  imports: [TypeOrmModule.forFeature([ReconciliationMismatchEntity])],
  controllers: [MismatchesController],
  providers: [MismatchesService, ReconciliationDetectorCronWorker],
})
export class MismatchesModule {}
