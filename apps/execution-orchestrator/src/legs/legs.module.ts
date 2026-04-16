import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditClientModule } from '@arbibot/nest-platform';
import {
  ExecutionLegEntity,
  ExecutionLegFillIdempotencyEntity,
  ExecutionPlanEntity,
} from '@arbibot/persistence';

import { PlansModule } from '../plans/plans.module';
import { HttpVenueAdapter } from '../venue/http-venue.adapter';
import { MockVenueAdapter } from '../venue/mock-venue.adapter';
import { VENUE_ADAPTER, type VenueAdapter } from '../venue/venue-adapter';

import { FillOutboundService } from './fill-outbound.service';
import { LegsService } from './legs.service';
import { PlanExecutionController } from './plan-execution.controller';
import { PlanLegActionsController } from './plan-leg-actions.controller';

@Module({
  imports: [
    AuditClientModule,
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
    MockVenueAdapter,
    {
      provide: VENUE_ADAPTER,
      useFactory: (mock: MockVenueAdapter): VenueAdapter => {
        const base = process.env.VENUE_HTTP_BASE_URL?.trim() ?? '';
        if (base.length > 0) {
          return new HttpVenueAdapter(base);
        }
        return mock;
      },
      inject: [MockVenueAdapter],
    },
  ],
})
export class LegsModule {}
