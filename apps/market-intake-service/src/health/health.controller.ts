import { Controller, Get } from '@nestjs/common';

import { DegradationStateService } from '../policy/degradation-state.service';

const THROTTLE_WINDOW_SEC = 300;

/**
 * Service-specific health probes for market-intake-service.
 *
 * The base `GET /health`, `GET /health/live`, and `GET /health/ready` endpoints
 * are provided by the shared `@Global() HealthModule` from
 * `@arbibot/nest-platform` (registered first in AppModule). This controller only
 * owns the service-specific `GET /health/degradation` probe to avoid a route
 * conflict on `GET /health`.
 */
@Controller()
export class HealthController {
  constructor(private readonly degradationState: DegradationStateService) {}

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
