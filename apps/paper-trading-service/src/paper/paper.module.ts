import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  PaperCapitalReservationEntity,
  PaperDriftSampleEntity,
  PaperPromotionCandidateEntity,
  PaperTradeEntity,
  PaperDiscoveryCandidateEntity,
} from '@arbibot/persistence';
import { AuditClientService } from '@arbibot/nest-platform';

import { PaperDriftController } from './paper-drift.controller';
import { PaperDriftService } from './paper-drift.service';
import { PaperDriftWorker } from './paper-drift-worker';
import { PaperPromotionCriteriaController } from './paper-promotion-criteria.controller';
import { PaperPromotionController } from './paper-promotion.controller';
import { PaperPromotionService } from './paper-promotion.service';
import { PaperTradesController } from './paper-trades.controller';
import { PaperTradesService } from './paper-trades.service';
import { PaperCapitalService } from './paper-capital.service';
import { PaperDiscoveryService } from '../paper-discovery/paper-discovery.service';
import { PaperDiscoveryWorker } from '../paper-discovery/paper-discovery-worker';
import { PaperDiscoveryController } from '../paper-discovery/paper-discovery.controller';
import { PaperPromotionQualityWorker } from './paper-promotion-quality.worker';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaperTradeEntity,
      PaperPromotionCandidateEntity,
      PaperDriftSampleEntity,
      PaperCapitalReservationEntity,
      PaperDiscoveryCandidateEntity,
    ]),
  ],
  controllers: [
    PaperTradesController,
    PaperPromotionController,
    PaperPromotionCriteriaController,
    PaperDriftController,
    PaperDiscoveryController,
  ],
  providers: [
    PaperTradesService,
    PaperPromotionService,
    PaperDriftService,
    PaperDriftWorker,
    PaperCapitalService,
    PaperDiscoveryService,
    PaperDiscoveryWorker,
    PaperPromotionQualityWorker,
    AuditClientService,
  ],
  exports: [
    PaperTradesService,
    PaperPromotionService,
    PaperDriftService,
    PaperCapitalService,
    PaperDiscoveryService,
  ],
})
export class PaperModule {}
