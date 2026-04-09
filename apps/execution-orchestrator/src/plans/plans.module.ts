import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  CapitalReservationEntity,
  ExecutionPlanEntity,
  RiskDecisionEntity,
} from '@arbibot/persistence';

import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ExecutionPlanEntity,
      CapitalReservationEntity,
      RiskDecisionEntity,
    ]),
  ],
  controllers: [PlansController],
  providers: [PlansService],
})
export class PlansModule {}
