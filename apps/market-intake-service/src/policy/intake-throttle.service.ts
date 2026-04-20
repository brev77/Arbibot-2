import { Injectable } from '@nestjs/common';

import type { IngestMarketSnapshotDto } from '../snapshots/dto/ingest-market-snapshot.dto';
import { DegradationStateService } from './degradation-state.service';
import {
  intakeRoutingTierTotal,
  intakeThrottledSnapshotsTotal,
} from './intake-policy-metrics';
import { PolicyCacheService } from './policy-cache.service';
import type { PolicyBundle } from './policy-types';

export type ThrottleDecision =
  | { readonly allow: true; readonly reason: string; readonly routingTier: string }
  | {
      readonly allow: false;
      readonly reason: string;
      readonly routingTier: string;
      readonly requireAudit: boolean;
    };

const DEFAULT_WARM_MS = 5000;
const DEFAULT_COLD_MS = 30_000;

function listHasKey(list: readonly string[] | undefined, key: string): boolean {
  if (list === undefined || list.length === 0) {
    return false;
  }
  if (list.includes('*')) {
    return true;
  }
  return list.includes(key);
}

function resolveRoutingTier(
  bundle: PolicyBundle,
  instrumentKey: string | undefined,
): 'hot' | 'warm' | 'cold' {
  const k = instrumentKey?.trim() ?? '';
  const r = bundle.routing;
  if (k.length > 0 && r !== null) {
    if (r.hot?.enabled === true && listHasKey(r.hot.instrumentKeys, k)) {
      return 'hot';
    }
    if (r.warm?.enabled === true && listHasKey(r.warm.instrumentKeys, k)) {
      return 'warm';
    }
    if (r.cold?.enabled === true && listHasKey(r.cold.instrumentKeys, k)) {
      return 'cold';
    }
  }
  if (k.length > 0) {
    const wl = bundle.watchlistItems.find((i) => i.instrumentKey === k);
    if (wl !== undefined) {
      const t = wl.tier.toLowerCase();
      if (t === 'hot' || t === 'warm' || t === 'cold') {
        return t;
      }
    }
  }
  return 'hot';
}

function samplingKey(dto: IngestMarketSnapshotDto): string {
  const ik = dto.instrumentKey?.trim();
  if (ik !== undefined && ik.length > 0) {
    return `i:${ik}`;
  }
  return `v:${dto.venueCode}:${dto.venueSymbol}`;
}

@Injectable()
export class IntakeThrottleService {
  private readonly lastAllowedMs = new Map<string, number>();

  constructor(
    private readonly policyCache: PolicyCacheService,
    private readonly degradationState: DegradationStateService,
  ) {}

  async evaluate(dto: IngestMarketSnapshotDto): Promise<ThrottleDecision> {
    if (process.env.INTAKE_THROTTLING_ENABLED !== 'true') {
      intakeRoutingTierTotal.inc({ tier: 'disabled' });
      return { allow: true, reason: 'throttling_disabled', routingTier: 'hot' };
    }

    const bundle = await this.policyCache.getBundle();
    const throttle = bundle.throttle ?? {};
    const instrumentKey = dto.instrumentKey?.trim();
    const routeKey = dto.routeKey?.trim();

    const routingTier = resolveRoutingTier(bundle, instrumentKey);
    intakeRoutingTierTotal.inc({ tier: routingTier });

    const minScore = throttle.minRouteScore ?? 0;
    if (routeKey !== undefined && routeKey.length > 0 && minScore > 0) {
      const score = await this.policyCache.getRouteScore(routeKey);
      if (score !== null && score < minScore) {
        this.recordThrottle('score');
        return {
          allow: false,
          reason: 'route_score_below_min',
          routingTier,
          requireAudit: throttle.requireAuditOnThrottle === true,
        };
      }
    }

    if (routingTier === 'hot') {
      return { allow: true, reason: 'tier_hot', routingTier };
    }

    const intervalMs =
      routingTier === 'warm'
        ? throttle.warmSampleIntervalMs ?? DEFAULT_WARM_MS
        : throttle.coldSampleIntervalMs ?? DEFAULT_COLD_MS;

    const key = samplingKey(dto);
    const now = Date.now();
    const last = this.lastAllowedMs.get(key) ?? 0;
    if (now - last < intervalMs) {
      this.recordThrottle('tier');
      return {
        allow: false,
        reason: 'sampled_by_tier_interval',
        routingTier,
        requireAudit: throttle.requireAuditOnThrottle === true,
      };
    }
    this.lastAllowedMs.set(key, now);
    return { allow: true, reason: 'sample_passed', routingTier };
  }

  private recordThrottle(reason: string): void {
    intakeThrottledSnapshotsTotal.inc({ reason });
    this.degradationState.recordThrottle();
  }
}
