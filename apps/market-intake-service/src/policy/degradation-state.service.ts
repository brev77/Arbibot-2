import { Injectable } from '@nestjs/common';

import { PolicyCacheService } from './policy-cache.service';

const THROTTLE_WINDOW_MS = 300_000;

/**
 * Operator-facing degradation snapshot (see docs/phase4-ui-degraded-signals.md).
 */
@Injectable()
export class DegradationStateService {
  private readonly throttleTimestampsMs: number[] = [];

  constructor(private readonly policyCache: PolicyCacheService) {}

  recordThrottle(): void {
    const now = Date.now();
    this.throttleTimestampsMs.push(now);
    this.prune(now);
  }

  private prune(now: number): void {
    const cutoff = now - THROTTLE_WINDOW_MS;
    while (
      this.throttleTimestampsMs.length > 0 &&
      (this.throttleTimestampsMs[0] ?? 0) < cutoff
    ) {
      this.throttleTimestampsMs.shift();
    }
  }

  getSnapshot(): {
    readonly fallbackMode: boolean;
    readonly policyCacheTtlMs: number;
    readonly lastPolicyRefreshAtIso: string | null;
    readonly throttledCount5m: number;
    readonly intakeThrottlingEnabled: boolean;
  } {
    const now = Date.now();
    this.prune(now);
    const b = this.policyCache.getCachedBundle();
    return {
      fallbackMode: b?.fallbackMode ?? false,
      policyCacheTtlMs: this.policyCache.getTtlMs(),
      lastPolicyRefreshAtIso:
        b !== null ? new Date(b.fetchedAtMs).toISOString() : null,
      throttledCount5m: this.throttleTimestampsMs.length,
      intakeThrottlingEnabled:
        process.env.INTAKE_THROTTLING_ENABLED === 'true',
    };
  }
}
