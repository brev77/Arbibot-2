import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  ExecutionLegEntity,
  ExecutionPlanEntity,
  OnChainTransaction,
} from '@arbibot/persistence';

import { IntegrationModule } from '../integration/integration.module';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';

@Module({
  imports: [
    IntegrationModule,
    TypeOrmModule.forFeature([
      ExecutionPlanEntity,
      ExecutionLegEntity,
      OnChainTransaction,
    ]),
  ],
  controllers: [PlansController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
