import { Module } from '@nestjs/common';
import { AuditClientService } from '@arbibot/nest-platform';

import { IncidentBriefsService } from './incident-briefs.service';
import { HermesAuthGuard } from './hermes-auth.guard';
import { HermesController } from './hermes.controller';
import { HermesMutationController } from './hermes-mutation.controller';
import { HermesMutationRateLimitGuard } from './hermes-mutation-rate-limit.guard';
import { HermesMutationService } from './hermes-mutation.service';
import { HermesRateLimitService } from './hermes-rate-limit.service';
import { HermesUpstreamService } from './hermes-upstream.service';
import { SafeModeService } from './safe-mode.service';

@Module({
  controllers: [HermesController, HermesMutationController],
  providers: [
    HermesUpstreamService,
    HermesAuthGuard,
    AuditClientService,
    IncidentBriefsService,
    SafeModeService,
    HermesMutationService,
    HermesRateLimitService,
    HermesMutationRateLimitGuard,
  ],
})
export class HermesModule {}
