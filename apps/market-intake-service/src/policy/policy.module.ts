import { Global, Module } from '@nestjs/common';

import { DegradationStateService } from './degradation-state.service';
import { IntakeThrottleService } from './intake-throttle.service';
import { PolicyCacheService } from './policy-cache.service';

@Global()
@Module({
  providers: [PolicyCacheService, DegradationStateService, IntakeThrottleService],
  exports: [PolicyCacheService, DegradationStateService, IntakeThrottleService],
})
export class PolicyModule {}
