import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  PaperDriftSampleEntity,
  PaperPromotionCandidateEntity,
  PaperTradeEntity,
} from '@arbibot/persistence';

import { PaperDriftController } from './paper-drift.controller';
import { PaperDriftService } from './paper-drift.service';
import { PaperPromotionController } from './paper-promotion.controller';
import { PaperPromotionService } from './paper-promotion.service';
import { PaperTradesController } from './paper-trades.controller';
import { PaperTradesService } from './paper-trades.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaperTradeEntity,
      PaperPromotionCandidateEntity,
      PaperDriftSampleEntity,
    ]),
  ],
  controllers: [PaperTradesController, PaperPromotionController, PaperDriftController],
  providers: [PaperTradesService, PaperPromotionService, PaperDriftService],
  exports: [PaperTradesService, PaperPromotionService, PaperDriftService],
})
export class PaperModule {}
