import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditClientModule } from '@arbibot/nest-platform';
import {
  ExecutionLegEntity,
  ExecutionLegFillIdempotencyEntity,
  ExecutionPlanEntity,
} from '@arbibot/persistence';

import { ExecutionModule } from '../execution/execution.module';
import { VenueFactoryService } from '../execution/venue-factory.service';
import { PlansModule } from '../plans/plans.module';
import { MockVenueAdapter } from '../venue/mock-venue.adapter';
import { VENUE_ADAPTER } from '../venue/venue-adapter';

import { FillOutboundService } from './fill-outbound.service';
import { LegAutoDriverWorker } from './leg-auto-driver.worker';
import { LegsService } from './legs.service';
import { PartialFillPlaybookService } from './partial-fill-playbook.service';
import { PlanExecutionController } from './plan-execution.controller';
import { PlanLegActionsController } from './plan-leg-actions.controller';
import { StuckPlanReaperWorker } from './stuck-plan-reaper.worker';
import { SettlementRelayWorker } from './settlement-relay.worker';

@Module({
  imports: [
    AuditClientModule,
    ExecutionModule,
    PlansModule,
    TypeOrmModule.forFeature([
      ExecutionPlanEntity,
      ExecutionLegEntity,
      ExecutionLegFillIdempotencyEntity,
    ]),
  ],
  controllers: [PlanExecutionController, PlanLegActionsController],
  providers: [
    FillOutboundService,
    LegsService,
    PartialFillPlaybookService,
    StuckPlanReaperWorker,
    SettlementRelayWorker,
    LegAutoDriverWorker,
    MockVenueAdapter,
    {
      provide: VENUE_ADAPTER,
      useExisting: VenueFactoryService,
    },
    VenueFactoryService,
  ],
})
export class LegsModule {}
