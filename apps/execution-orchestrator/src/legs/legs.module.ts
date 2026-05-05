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
import { LegsService } from './legs.service';
import { PartialFillPlaybookService } from './partial-fill-playbook.service';
import { PlanExecutionController } from './plan-execution.controller';
import { PlanLegActionsController } from './plan-leg-actions.controller';

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
    MockVenueAdapter,
    {
      provide: VENUE_ADAPTER,
      useExisting: VenueFactoryService,
    },
    VenueFactoryService,
  ],
})
export class LegsModule {}
