import { Injectable, Logger } from '@nestjs/common';

import { signedFetch } from '@arbibot/nest-platform';

import { intakePolicyCacheHits, intakePolicyCacheMisses, intakePolicyFallbackTotal } from './intake-policy-metrics';
import type {
  IntakeRoutingTiersConfig,
  IntakeThrottlingConfig,
  PolicyBundle,
} from './policy-types';

const DEFAULT_CACHE_TTL_MS = 120_000;
const ROUTE_SCORE_CACHE_MAX_KEYS = 500;

function clampTtlMs(raw: string | undefined): number {
  if (raw === undefined || raw.length === 0) {
    return DEFAULT_CACHE_TTL_MS;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return DEFAULT_CACHE_TTL_MS;
  }
  return Math.min(300_000, Math.max(61_000, Math.floor(n)));
}

function configBaseUrl(): string {
  const u = (
    process.env.CONFIG_SERVICE_URL ??
    process.env.CONFIG_API_BASE ??
    'http://127.0.0.1:3019'
  ).replace(/\/$/, '');
  return u;
}

function riskBaseUrl(): string {
  return (process.env.RISK_SERVICE_URL ?? 'http://127.0.0.1:3000').replace(
    /\/$/,
    '',
  );
}

function parseJsonConfigValue(raw: string | undefined): unknown {
  if (raw === undefined || raw.trim().length === 0) {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function asThrottle(obj: unknown): IntakeThrottlingConfig | null {
  if (obj === null || typeof obj !== 'object') {
    return null;
  }
  const o = obj as Record<string, unknown>;
  return {
    requireAuditOnThrottle:
      typeof o.requireAuditOnThrottle === 'boolean'
        ? o.requireAuditOnThrottle
        : undefined,
    warmSampleIntervalMs:
      typeof o.warmSampleIntervalMs === 'number' ? o.warmSampleIntervalMs : undefined,
    coldSampleIntervalMs:
      typeof o.coldSampleIntervalMs === 'number' ? o.coldSampleIntervalMs : undefined,
    minRouteScore:
      typeof o.minRouteScore === 'number' ? o.minRouteScore : undefined,
  };
}

function asRouting(obj: unknown): IntakeRoutingTiersConfig | null {
  if (obj === null || typeof obj !== 'object') {
    return null;
  }
  const o = obj as Record<string, unknown>;
  const tier = (x: unknown) => {
    if (x === null || typeof x !== 'object') {
      return undefined;
    }
    const t = x as Record<string, unknown>;
    return {
      enabled: typeof t.enabled === 'boolean' ? t.enabled : undefined,
      instrumentKeys: Array.isArray(t.instrumentKeys)
        ? t.instrumentKeys.filter((k): k is string => typeof k === 'string')
        : undefined,
    };
  };
  return {
    hot: tier(o.hot),
    warm: tier(o.warm),
    cold: tier(o.cold),
  };
}

async function fetchJson(
  url: string,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await signedFetch(url, { signal: ac.signal });
    const status = res.status;
    if (!res.ok) {
      return { ok: false, status, body: null };
    }
    const body = (await res.json()) as unknown;
    return { ok: true, status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Read-only policy bundle for intake throttling (ADR Phase 4).
 * Refreshes from config-service effective keys + risk read APIs; never writes OLTP policy tables.
 */
@Injectable()
export class PolicyCacheService {
  private readonly logger = new Logger(PolicyCacheService.name);
  private readonly ttlMs = clampTtlMs(process.env.INTAKE_POLICY_CACHE_TTL_MS);
  private readonly httpTimeoutMs = Math.min(
    15_000,
    Math.max(1000, Number(process.env.INTAKE_POLICY_HTTP_TIMEOUT_MS ?? 8000) || 8000),
  );

  private bundle: PolicyBundle | null = null;
  private inflight: Promise<PolicyBundle> | null = null;

  getTtlMs(): number {
    return this.ttlMs;
  }

  getCachedBundle(): PolicyBundle | null {
    return this.bundle;
  }

  /**
   * Returns warm cache when fresh; otherwise awaits refresh (single-flight).
   */
  async getBundle(): Promise<PolicyBundle> {
    const now = Date.now();
    if (this.bundle !== null && now - this.bundle.fetchedAtMs < this.ttlMs) {
      intakePolicyCacheHits.inc({ layer: 'bundle' });
      return this.bundle;
    }
    intakePolicyCacheMisses.inc({ layer: 'bundle' });
    if (this.inflight !== null) {
      return this.inflight;
    }
    this.inflight = this.refreshBundle().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async refreshBundle(): Promise<PolicyBundle> {
    const base = configBaseUrl();
    const risk = riskBaseUrl();
    const env = process.env.INTAKE_CONFIG_ENVIRONMENT;
    const tenant = process.env.INTAKE_CONFIG_TENANT_ID;
    const q = new URLSearchParams();
    if (env !== undefined && env.length > 0) {
      q.set('environment', env);
    }
    if (tenant !== undefined && tenant.length > 0) {
      q.set('tenantId', tenant);
    }
    const qs = q.toString();
    const suffix = qs.length > 0 ? `?${qs}` : '';

    let fallbackMode = false;
    let throttle: IntakeThrottlingConfig | null = null;
    let routing: IntakeRoutingTiersConfig | null = null;

    const throttleUrl = `${base}/policy/configurations/intake.throttling/effective${suffix}`;
    const routingUrl = `${base}/policy/configurations/intake.routing.tiers/effective${suffix}`;
    const tiersUrl = `${risk}/policy/watchlist/tiers`;

    const [thRes, rtRes, twRes] = await Promise.all([
      fetchJson(throttleUrl, this.httpTimeoutMs),
      fetchJson(routingUrl, this.httpTimeoutMs),
      fetchJson(tiersUrl, this.httpTimeoutMs),
    ]);

    if (thRes.ok && thRes.body !== null && typeof thRes.body === 'object') {
      const cfg = thRes.body as { configValue?: string };
      throttle = asThrottle(parseJsonConfigValue(cfg.configValue));
    } else if (!thRes.ok) {
      fallbackMode = true;
      intakePolicyFallbackTotal.inc();
      this.logger.warn(
        `intake.throttling effective fetch failed status=${thRes.status}`,
      );
    }

    if (rtRes.ok && rtRes.body !== null && typeof rtRes.body === 'object') {
      const cfg = rtRes.body as { configValue?: string };
      routing = asRouting(parseJsonConfigValue(cfg.configValue));
    } else if (!rtRes.ok) {
      if (!fallbackMode) {
        intakePolicyFallbackTotal.inc();
      }
      fallbackMode = true;
      this.logger.warn(
        `intake.routing.tiers effective fetch failed status=${rtRes.status}`,
      );
    }

    const watchlistItems: Array<{
      readonly instrumentKey: string;
      readonly tier: string;
    }> = [];
    if (twRes.ok && twRes.body !== null && typeof twRes.body === 'object') {
      const body = twRes.body as { items?: unknown };
      if (Array.isArray(body.items)) {
        for (const it of body.items) {
          if (
            it !== null &&
            typeof it === 'object' &&
            typeof (it as { instrumentKey?: string }).instrumentKey ===
              'string' &&
            typeof (it as { tier?: string }).tier === 'string'
          ) {
            watchlistItems.push({
              instrumentKey: (it as { instrumentKey: string }).instrumentKey,
              tier: (it as { tier: string }).tier,
            });
          }
        }
      }
    } else {
      if (!fallbackMode) {
        intakePolicyFallbackTotal.inc();
      }
      fallbackMode = true;
      this.logger.warn(
        `risk watchlist tiers fetch failed status=${twRes.status}`,
      );
    }

    const routeScoreByKey = this.bundle?.routeScoreByKey ?? new Map<string, number>();

    const bundle: PolicyBundle = {
      throttle,
      routing,
      watchlistItems,
      routeScoreByKey,
      fetchedAtMs: Date.now(),
      fallbackMode,
    };
    this.bundle = bundle;
    return bundle;
  }

  /**
   * Latest score for a route (read-only); cached in bundle map with LRU cap.
   */
  async getRouteScore(routeKey: string): Promise<number | null> {
    const rk = routeKey.trim();
    if (rk.length === 0) {
      return null;
    }
    const b = await this.getBundle();
    const cached = b.routeScoreByKey.get(rk);
    if (cached !== undefined) {
      return cached;
    }
    const url = `${riskBaseUrl()}/policy/route-scoring-history/${encodeURIComponent(rk)}`;
    const res = await fetchJson(url, this.httpTimeoutMs);
    if (!res.ok || res.body === null || typeof res.body !== 'object') {
      return null;
    }
    const body = res.body as { items?: unknown };
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return null;
    }
    const first = body.items[0];
    if (
      first === null ||
      typeof first !== 'object' ||
      typeof (first as { score?: unknown }).score !== 'number'
    ) {
      return null;
    }
    const score = (first as { score: number }).score;
    const map = new Map(b.routeScoreByKey);
    if (map.size >= ROUTE_SCORE_CACHE_MAX_KEYS) {
      const { value: firstKey, done } = map.keys().next();
      if (!done && firstKey !== undefined) {
        map.delete(firstKey);
      }
    }
    map.set(rk, score);
    if (this.bundle !== null) {
      this.bundle = { ...this.bundle, routeScoreByKey: map };
    }
    return score;
  }
}
