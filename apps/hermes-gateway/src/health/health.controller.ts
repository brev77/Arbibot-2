import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Optional,
} from '@nestjs/common';

/**
 * Hermes-gateway health probes.
 *
 * Mirrors the API surface of the shared `HealthController` from
 * `@arbibot/nest-platform` (GET /health, /health/live, /health/ready) so hermes
 * has the same probe contract as every other service, while preserving the
 * gateway-specific `service` / `phase` payload on `GET /health` and the operator
 * BFF probe.
 *
 * `GET /health/ready` pings the DataSource (`SELECT 1`) when TypeORM is
 * registered; hermes-gateway currently has no DB, so the optional injection
 * resolves to `undefined` and the probe degrades to liveness-only (200). The
 * `SelectCapableDataSource` structural interface avoids a hard `typeorm`
 * compile-time dependency.
 */

/** Minimal structural shape of a TypeORM DataSource for a `SELECT 1` ping. */
interface SelectCapableDataSource {
  query(sql: string): Promise<unknown>;
}

interface HealthCheckResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

interface ReadinessReport {
  ok: boolean;
  checks: Record<string, HealthCheckResult>;
}

@Controller()
export class HealthController {
  constructor(
    @Optional() private readonly dataSource?: SelectCapableDataSource,
  ) {}

  @Get('health')
  health(): { ok: true; service: string; phase: string } {
    return { ok: true, service: 'hermes-gateway', phase: '5-gateway-read' };
  }

  /** Liveness probe: process is up. Always 200. */
  @Get('health/live')
  live(): { ok: true } {
    return { ok: true };
  }

  /**
   * Readiness probe: 200 if critical dependencies are reachable, 503 otherwise.
   * Pings the database (`SELECT 1`) when a DataSource is registered; services
   * without a DB degrade to a liveness-only check (200).
   */
  @Get('health/ready')
  async ready(): Promise<ReadinessReport> {
    const checks: Record<string, HealthCheckResult> = {};

    if (this.dataSource !== undefined) {
      checks.database = await this.pingDatabase();
    }

    const ok = Object.values(checks).every((c) => c.ok);
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

  /**
   * Optional probe: GET operator BFF summary when OPERATOR_WEB_BFF_BASE is set (server-side).
   */
  @Get('health/operator-bff')
  async operatorBffProbe(): Promise<{
    configured: boolean;
    reachable: boolean | null;
    status: number | null;
  }> {
    const base = process.env.OPERATOR_WEB_BFF_BASE?.replace(/\/$/, '') ?? '';
    if (base.length === 0) {
      return { configured: false, reachable: null, status: null };
    }
    try {
      const url = `${base}/api/operator/dashboard/summary`;
      const res = await fetch(url, { method: 'GET' });
      return {
        configured: true,
        reachable: res.ok,
        status: res.status,
      };
    } catch {
      return { configured: true, reachable: false, status: null };
    }
  }
}
