import { Module } from '@nestjs/common';
import { AuditClientService } from '@arbibot/nest-platform';

import { IncidentBriefsService } from './incident-briefs.service';
import { OpenclawAuthGuard } from './openclaw-auth.guard';
import { OpenclawController } from './openclaw.controller';
import { OpenclawMutationController } from './openclaw-mutation.controller';
import { OpenclawMutationRateLimitGuard } from './openclaw-mutation-rate-limit.guard';
import { OpenclawMutationService } from './openclaw-mutation.service';
import { OpenclawRateLimitService } from './openclaw-rate-limit.service';
import { OpenclawUpstreamService } from './openclaw-upstream.service';
import { SafeModeService } from './safe-mode.service';

@Module({
  controllers: [OpenclawController, OpenclawMutationController],
  providers: [
    OpenclawUpstreamService,
    OpenclawAuthGuard,
    AuditClientService,
    IncidentBriefsService,
    SafeModeService,
    OpenclawMutationService,
    OpenclawRateLimitService,
    OpenclawMutationRateLimitGuard,
  ],
})
export class OpenclawModule {}
