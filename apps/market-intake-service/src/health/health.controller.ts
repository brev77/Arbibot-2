import { Controller, Get } from '@nestjs/common';

import { DegradationStateService } from '../policy/degradation-state.service';

const THROTTLE_WINDOW_SEC = 300;

@Controller()
export class HealthController {
  constructor(private readonly degradationState: DegradationStateService) {}

  @Get('health')
  health(): { ok: true; service: string } {
    return { ok: true, service: 'market-intake-service' };
  }

  /**
   * Operator / UI degradation signals (Phase 4).
   */
  @Get('health/degradation')
  degradationStatus(): {
    tier: 'baseline' | 'hot' | 'warm' | 'cold';
    fallbackMode: boolean;
    throttledRate: number;
    policyCacheTtlMs: number;
    lastPolicyRefreshAtIso: string | null;
    intakeThrottlingEnabled: boolean;
  } {
    const s = this.degradationState.getSnapshot();
    const throttledRate =
      s.throttledCount5m > 0 ? s.throttledCount5m / (THROTTLE_WINDOW_SEC) : 0;
    return {
      tier: s.fallbackMode ? 'baseline' : 'hot',
      fallbackMode: s.fallbackMode,
      throttledRate,
      policyCacheTtlMs: s.policyCacheTtlMs,
      lastPolicyRefreshAtIso: s.lastPolicyRefreshAtIso,
      intakeThrottlingEnabled: s.intakeThrottlingEnabled,
    };
  }
}
