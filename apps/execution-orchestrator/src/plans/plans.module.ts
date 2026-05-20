import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  ExecutionLegEntity,
  ExecutionPlanEntity,
  OnChainTransaction,
} from '@arbibot/persistence';

import { ExecutionModule } from '../execution/execution.module';
import { IntegrationModule } from '../integration/integration.module';
import { MultiLegPlanBuilderService } from './multi-leg-plan-builder.service';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';

@Module({
  imports: [
    ExecutionModule,
    IntegrationModule,
    TypeOrmModule.forFeature([
      ExecutionPlanEntity,
      ExecutionLegEntity,
      OnChainTransaction,
    ]),
  ],
  controllers: [PlansController],
  providers: [PlansService, MultiLegPlanBuilderService],
  exports: [PlansService, MultiLegPlanBuilderService],
})
export class PlansModule {}
