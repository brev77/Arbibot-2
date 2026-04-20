import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AuditClientService, type IAuditClient } from '@arbibot/nest-platform';

import { RouteScoringWriterService } from './route-scoring-writer.service';
import { WatchlistTieringWriterService } from './watchlist-tiering-writer.service';

function parseIntervalMs(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 10_000) {
    return fallback;
  }
  return Math.floor(n);
}

function jobsEnabled(): boolean {
  const v = process.env.RISK_POLICY_JOBS_ENABLED?.trim().toLowerCase();
  if (v === undefined || v.length === 0) {
    return false;
  }
  return v === 'true' || v === '1' || v === 'yes';
}

/**
 * Schedules watchlist tiering + route scoring writers; supports manual runs from HTTP.
 */
@Injectable()
export class PolicyJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PolicyJobsService.name);
  private watchlistTimer: ReturnType<typeof setInterval> | null = null;
  private routeTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly watchlistWriter: WatchlistTieringWriterService,
    private readonly routeWriter: RouteScoringWriterService,
    @Inject(AuditClientService) private readonly audit: IAuditClient,
  ) {}

  onModuleInit(): void {
    if (!jobsEnabled()) {
      this.log.log('RISK_POLICY_JOBS_ENABLED is off — policy writer cron disabled');
      return;
    }
    const wMs = parseIntervalMs('WATCHLIST_TIERING_INTERVAL_MS', 600_000);
    const rMs = parseIntervalMs('ROUTE_SCORING_INTERVAL_MS', 3_600_000);

    this.watchlistTimer = setInterval(() => {
      void this.runWatchlistTiering('interval').catch((err: unknown) => {
        this.log.error(
          `watchlist tiering job failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, wMs);
    this.watchlistTimer.unref?.();

    this.routeTimer = setInterval(() => {
      void this.runRouteScoring('interval').catch((err: unknown) => {
        this.log.error(
          `route scoring job failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, rMs);
    this.routeTimer.unref?.();

    this.log.log(
      `policy jobs enabled: watchlist every ${wMs}ms, route scoring every ${rMs}ms`,
    );
  }

  onModuleDestroy(): void {
    if (this.watchlistTimer !== null) {
      clearInterval(this.watchlistTimer);
      this.watchlistTimer = null;
    }
    if (this.routeTimer !== null) {
      clearInterval(this.routeTimer);
      this.routeTimer = null;
    }
  }

  async runWatchlistTiering(
    trigger: 'interval' | 'http',
  ): Promise<Awaited<ReturnType<WatchlistTieringWriterService['runCycle']>>> {
    const correlationId = randomUUID();
    const summary = await this.watchlistWriter.runCycle();
    this.audit.record({
      correlationId,
      actor: 'risk-service',
      action: 'WatchlistTieringJob',
      resourceType: 'WatchlistTierSnapshot',
      resourceId: trigger,
      payload: { ...summary, trigger },
      idempotencyKey: `risk:WatchlistTieringJob:${correlationId}`,
    });
    return summary;
  }

  async runRouteScoring(
    trigger: 'interval' | 'http',
  ): Promise<Awaited<ReturnType<RouteScoringWriterService['runCycle']>>> {
    const correlationId = randomUUID();
    const summary = await this.routeWriter.runCycle();
    this.audit.record({
      correlationId,
      actor: 'risk-service',
      action: 'RouteScoringJob',
      resourceType: 'RouteScoringHistory',
      resourceId: trigger,
      payload: { ...summary, trigger },
      idempotencyKey: `risk:RouteScoringJob:${correlationId}`,
    });
    return summary;
  }
}
