import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  OutboxEventEntity,
  RiskDecisionEntity,
  RiskWindowReservationEntity,
} from '@arbibot/persistence';

import { RiskController } from './risk.controller';
import { RiskService } from './risk.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RiskDecisionEntity,
      RiskWindowReservationEntity,
      OutboxEventEntity,
    ]),
  ],
  controllers: [RiskController],
  providers: [RiskService],
  exports: [RiskService],
})
export class RiskModule {}
