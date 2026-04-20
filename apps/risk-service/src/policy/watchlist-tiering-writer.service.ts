import { Injectable, Logger } from '@nestjs/common';

import { getPolicyWriterMetrics } from './policy-metrics';
import { TokenProfileService } from './token-profile.service';
import { WatchlistTierService } from './watchlist-tier.service';

export type WatchlistTierName = 'hot' | 'warm' | 'cold';

function parsePositiveUsd(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return n;
}

function classifyTier(maxNotionalUsd: number): {
  readonly tier: WatchlistTierName;
  readonly reason: string;
} {
  const hotMin = parsePositiveUsd('WATCHLIST_TIER_HOT_MIN_USD', 1_000_000);
  const warmMin = parsePositiveUsd('WATCHLIST_TIER_WARM_MIN_USD', 100_000);
  const cap = maxNotionalUsd;
  if (cap >= hotMin) {
    return {
      tier: 'hot',
      reason: `maxNotionalUsd=${cap}; tier=hot (>= hotMin ${hotMin} USD)`,
    };
  }
  if (cap >= warmMin) {
    return {
      tier: 'warm',
      reason: `maxNotionalUsd=${cap}; tier=warm (>= warmMin ${warmMin} USD, < hotMin ${hotMin} USD)`,
    };
  }
  return {
    tier: 'cold',
    reason: `maxNotionalUsd=${cap}; tier=cold (< warmMin ${warmMin} USD)`,
  };
}

export type WatchlistTieringRunSummary = {
  readonly instrumentsEvaluated: number;
  readonly snapshotsWritten: number;
};

/**
 * Background writer: token_profiles → watchlist_tier_snapshots (append-only).
 */
@Injectable()
export class WatchlistTieringWriterService {
  private readonly log = new Logger(WatchlistTieringWriterService.name);

  constructor(
    private readonly tokens: TokenProfileService,
    private readonly watchlist: WatchlistTierService,
  ) {}

  async runCycle(): Promise<WatchlistTieringRunSummary> {
    const m = getPolicyWriterMetrics();
    const { items } = await this.tokens.list();
    let snapshotsWritten = 0;
    for (const row of items) {
      m.watchlistEvaluations.inc();
      const { tier, reason } = classifyTier(row.maxNotionalUsd);
      const latest = await this.watchlist.findLatestForInstrument(row.instrumentKey);
      if (
        latest !== null &&
        latest.tier === tier &&
        latest.reason === reason
      ) {
        continue;
      }
      await this.watchlist.recordSnapshot(row.instrumentKey, tier, reason);
      m.watchlistChanges.inc();
      snapshotsWritten += 1;
    }
    this.log.debug(
      `watchlist tiering: evaluated=${items.length} written=${snapshotsWritten}`,
    );
    return { instrumentsEvaluated: items.length, snapshotsWritten };
  }
}
