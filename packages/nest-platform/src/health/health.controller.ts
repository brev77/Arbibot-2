import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Optional,
} from '@nestjs/common';

/**
 * Reusable health controller for all Arbibot Nest services (D4-A-5-PROBES).
 *
 * Endpoints:
 *   GET /health        — liveness alias (200 always); kept for backward
 *                        compatibility with existing compose probes that hit
 *                        /health on hermes-gateway / apps/web.
 *   GET /health/live   — liveness (200 always). Process is up.
 *   GET /health/ready  — readiness (200 if critical deps reachable, 503 if not).
 *                        Pings DataSource (SELECT 1) when TypeORM is registered;
 *                        services without a DB skip the check (degrade to live).
 *
 * Auth bypass: `/health` and `/health/*` are already public paths in
 * `service-auth/signature.ts` (ARBIBOT_SERVICE_AUTH_PUBLIC_PATHS).
 *
 * Note on the DataSource type: we import the TypeORM `DataSource` constructor
 * type lazily via a minimal structural interface to avoid a hard compile-time
 * dependency on `typeorm` for services that do not use it. At runtime, if a
 * DataSource-like provider (`query`, `destroy`) is bound in the DI container,
 * it is injected and pinged.
 */

/** Minimal structural shape of a TypeORM DataSource for a `SELECT 1` ping. */
interface SelectCapableDataSource {
  query(sql: string): Promise<unknown>;
}

/** Optional redis-like client with a PING command. */
interface PingCapableRedis {
  ping(): Promise<string>;
}

export interface HealthCheckResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export interface ReadinessReport {
  ok: boolean;
  checks: Record<string, HealthCheckResult>;
}

@Controller('health')
export class HealthController {
  constructor(
    @Optional() private readonly dataSource?: SelectCapableDataSource,
    @Optional() @Inject('REDIS_CLIENT') private readonly redis?: PingCapableRedis,
  ) {}

  /** Liveness alias at /health (backward compat with existing probes). */
  @Get()
  @HttpCode(HttpStatus.OK)
  health(): { ok: true } {
    return { ok: true };
  }

  /** Liveness probe: process is up. Always 200. */
  @Get('live')
  @HttpCode(HttpStatus.OK)
  live(): { ok: true } {
    return { ok: true };
  }

  /**
   * Readiness probe: 200 if critical dependencies are reachable, 503 otherwise.
   * Pings the database (`SELECT 1`) when a DataSource is registered, and redis
   * (`PING`) when a REDIS_CLIENT is registered. Services without those deps
   * degrade to a liveness-only check (200).
   */
  @Get('ready')
  async ready(): Promise<ReadinessReport> {
    const checks: Record<string, HealthCheckResult> = {};

    if (this.dataSource !== undefined) {
      checks.database = await this.pingDatabase();
    }
    if (this.redis !== undefined) {
      checks.redis = await this.pingRedis();
    }

    const ok = Object.values(checks).every((c) => c.ok);
    // Signal 503 with the report body so the orchestrator sees which check
    // failed. HttpException is handled by Nest's default exception filter and
    // preserves the JSON payload.
    if (!ok) {
      throw new HttpException(
        { ok: false, checks },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { ok: true, checks };
  }

  private async pingDatabase(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      await this.dataSource!.query('SELECT 1');
      return { ok: true, latencyMs: Date.now() - start };
    } catch (e) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  private async pingRedis(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const reply = await this.redis!.ping();
      const ok = typeof reply === 'string' && reply.toUpperCase() === 'PONG';
      return { ok, latencyMs: Date.now() - start };
    } catch (e) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
}
