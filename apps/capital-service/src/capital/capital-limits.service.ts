import { Injectable, Logger } from '@nestjs/common';
import { ServiceUnavailableException } from '@nestjs/common';

/**
 * Capital Limits Service (D4-B-3-CEILING, L3).
 *
 * Reads `capital.limits` from config-service (`GET /policy/configurations/
 * capital.limits/effective`, cached ~10s) and exposes the aggregate capital
 * ceiling (`maxActiveCapitalUsd`) used by `CapitalService.reserve()` to gate
 * `SUM(active reservations) + SUM(open positions) <= ceiling` under `FOR UPDATE`
 * — closing the C1 race.
 *
 * Precedence (env can only TIGHTEN — lower cap wins):
 *   1. `CAPITAL_MAX_ACTIVE_USD` env override (lower-bound)
 *   2. config-service `capital.limits.maxActiveCapitalUsd` (cached)
 *   3. fail-closed in production (throw → no reservation) when neither resolves;
 *      a safe default in non-prod so local dev / tests are not blocked.
 *
 * Mirrors the proven fetch/cache/fail-closed pattern from
 * `DexRiskPolicyService` (execution-orchestrator).
 */

const CONFIG_CACHE_TTL_MS = 10_000; // 10s — operational limit, short TTL
const HTTP_TIMEOUT_MS = 3_000;
const SAFE_DEFAULT_CEILING_USD = 1_000; // non-prod fallback only

interface ParsedCapitalLimits {
  maxActiveCapitalUsd?: unknown;
  maxDailyNotionalUsd?: unknown;
}

interface FetchJsonResult {
  ok: boolean;
  status: number;
  body: unknown;
}

function configBaseUrl(): string {
  return (
    process.env.CONFIG_SERVICE_URL ??
    process.env.CONFIG_API_BASE ??
    'http://127.0.0.1:3019'
  ).replace(/\/$/, '');
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

async function fetchJson(url: string): Promise<FetchJsonResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    const text = await res.text();
    let body: unknown = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

@Injectable()
export class CapitalLimitsService {
  private readonly logger = new Logger(CapitalLimitsService.name);

  private cache: { value: number; fetchedAtMs: number } | null = null;
  private inflight: Promise<void> | null = null;

  /**
   * Resolve the aggregate active-capital ceiling (USD). Env override
   * `CAPITAL_MAX_ACTIVE_USD` acts as a lower-bound (env can only tighten).
   * Fail-closed in production when neither config nor env resolves.
   */
  async getMaxActiveCapitalUsd(): Promise<number> {
    const envCeiling = this.parseEnvCeiling();

    if (this.cache === null || Date.now() - this.cache.fetchedAtMs > CONFIG_CACHE_TTL_MS) {
      await this.refresh().catch(() => {
        /* logged in refresh; fall through to cache / env / fail-closed */
      });
    }
    const configCeiling = this.cache?.value;

    if (envCeiling !== null && configCeiling !== undefined) {
      return Math.min(envCeiling, configCeiling);
    }
    if (envCeiling !== null) {
      return envCeiling;
    }
    if (configCeiling !== undefined) {
      return configCeiling;
    }

    // Neither resolved. Fail-closed in prod; safe default elsewhere.
    if (isProduction()) {
      this.logger.error(
        'capital ceiling unresolved (config-service unreachable AND no CAPITAL_MAX_ACTIVE_USD env) — FAIL-CLOSED in production. Set capital.limits or CAPITAL_MAX_ACTIVE_USD.',
      );
      throw new ServiceUnavailableException(
        'Capital ceiling unavailable: config-service unreachable and CAPITAL_MAX_ACTIVE_USD not set',
      );
    }
    this.logger.warn(
      `capital ceiling unresolved — using non-prod safe default $${SAFE_DEFAULT_CEILING_USD}`,
    );
    return SAFE_DEFAULT_CEILING_USD;
  }

  /** Force-refresh capital.limits from config-service (test/operation hook). */
  async refresh(): Promise<void> {
    if (this.inflight !== null) {
      await this.inflight;
      return;
    }
    this.inflight = (async () => {
      const url = `${configBaseUrl()}/policy/configurations/capital.limits/effective`;
      const res = await fetchJson(url);
      const parsed = this.parseResponse(res);
      if (parsed !== null) {
        this.cache = { value: parsed, fetchedAtMs: Date.now() };
      } else {
        this.logger.warn(
          `capital.limits effective fetch failed (status=${res.status}); retaining ${this.cache !== null ? 'stale cache' : 'no cache'}`,
        );
      }
    })();
    try {
      await this.inflight;
    } finally {
      this.inflight = null;
    }
  }

  /** Test-only: force a ceiling value without a network fetch. */
  setCacheForTest(value: number): void {
    this.cache = { value, fetchedAtMs: Date.now() };
  }

  // ── Parsing ───────────────────────────────────────────────────────────

  private parseResponse(res: FetchJsonResult): number | null {
    if (!res.ok || res.body === null || typeof res.body !== 'object') {
      return null;
    }
    const body = res.body as { configValue?: unknown };
    if (typeof body.configValue !== 'string' || body.configValue.length === 0) {
      return null;
    }
    let parsed: ParsedCapitalLimits;
    try {
      parsed = JSON.parse(body.configValue) as ParsedCapitalLimits;
    } catch {
      return null;
    }
    if (parsed === null || typeof parsed !== 'object') {
      return null;
    }
    const ceiling = asNumber(parsed.maxActiveCapitalUsd, NaN);
    return Number.isFinite(ceiling) && ceiling > 0 ? ceiling : null;
  }

  private parseEnvCeiling(): number | null {
    const raw = process.env.CAPITAL_MAX_ACTIVE_USD;
    if (raw === undefined || raw.trim().length === 0) {
      return null;
    }
    const v = Number(raw);
    return Number.isFinite(v) && v > 0 ? v : null;
  }
}
