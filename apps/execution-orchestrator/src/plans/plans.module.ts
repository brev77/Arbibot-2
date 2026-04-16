import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  CapitalReservationEntity,
  ExecutionLegEntity,
  ExecutionPlanEntity,
  RiskDecisionEntity,
} from '@arbibot/persistence';

import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ExecutionPlanEntity,
      ExecutionLegEntity,
      CapitalReservationEntity,
      RiskDecisionEntity,
    ]),
  ],
  controllers: [PlansController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
