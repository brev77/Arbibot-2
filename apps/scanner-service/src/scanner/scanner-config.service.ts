import { Injectable, Logger } from '@nestjs/common';
import { signedFetch } from '@arbibot/nest-platform';

import {
  DEFAULT_SCANNER_CONFIG_CACHE_TTL_MS,
  DEFAULT_SCANNER_DEDUP_COOLDOWN_MS,
  DEFAULT_SCANNER_FINDINGS_RETENTION_DAYS,
  DEFAULT_SCANNER_OPPORTUNITY_PUBLISH_TIMEOUT_MS,
  DEFAULT_SCANNER_ORPHAN_MAX_ATTEMPTS,
  DEFAULT_SCANNER_ORPHAN_RETRY_INTERVAL_MS,
  DEFAULT_SCANNER_POOL_CACHE_TTL_MS,
  DEFAULT_SCANNER_RPC_RATE_LIMIT_RPS,
  MAX_SCANNER_CONFIG_CACHE_TTL_MS,
  MIN_SCANNER_CONFIG_CACHE_TTL_MS,
  MIN_SCANNER_INSTANCE_INTERVAL_MS,
  SCANNER_DEFAULTS_POLICY_KEY,
  SCANNER_INSTANCES_POLICY_KEY,
} from './scanner-config.constants';
import type {
  ScannerDefaultsJson,
  ScannerDefaultsResolved,
  ScannerInstanceJson,
  ScannerInstancesJson,
  ScannerResolvedConfig,
} from './scanner-config.types';

/**
 * Scanner config loader (S1-2).
 *
 * Loads `scanner.defaults` and `scanner.instances` from config-service with a TTL cache,
 * falling back to env / constants when config-service is unreachable or a key is absent.
 * Pattern mirrors paper-discovery.service.ts:255-289 (`ensureEffectiveConfigLoaded`):
 *   - TTL floor/ceiling via Math.min/Math.max clamp (5s–300s)
 *   - last-fetched remote JSON is cached even when null, so a transient config-service
 *     outage does not cause repeated fetches inside the TTL window
 *   - fetch failures are non-fatal: warn + env fallback, worker keeps cycling
 *
 * Single-writer note: config-service OWNS `scanner.*`. This service is read-only.
 * Force-refresh is exposed for the operator `POST /scanner/instances/:id/refresh-config`
 * endpoint (S1-7) so a config change applies immediately instead of waiting for the TTL.
 */
@Injectable()
export class ScannerConfigService {
  private readonly logger = new Logger(ScannerConfigService.name);

  private defaultsCache: { at: number; remote: ScannerDefaultsJson | null } | null =
    null;
  private instancesCache: {
    at: number;
    remote: ScannerInstancesJson | null;
  } | null = null;
  private resolved: ScannerResolvedConfig;

  constructor() {
    // Initialize from env baseline; remote merge happens on first ensureEffectiveConfigLoaded().
    this.resolved = this.mergeWithRemote(
      this.loadDefaultsFromEnv(),
      null,
      this.loadInstancesFromEnv(),
    );
  }

  /**
   * Refresh `scanner.defaults` + `scanner.instances` if the TTL has expired.
   * Safe to call at the start of every worker cycle. Idempotent on cache hit.
   */
  async ensureEffectiveConfigLoaded(): Promise<void> {
    const ttlMs = this.resolvedDefaultsConfigCacheTtlMs();
    const now = Date.now();

    const defaultsFresh =
      this.defaultsCache !== null && now - this.defaultsCache.at < ttlMs;
    const instancesFresh =
      this.instancesCache !== null && now - this.instancesCache.at < ttlMs;

    // Re-derive env baseline each call — env may have changed since last run.
    const envDefaults = this.loadDefaultsFromEnv();
    const envInstances = this.loadInstancesFromEnv();

    if (defaultsFresh && instancesFresh) {
      this.resolved = this.mergeWithRemote(
        envDefaults,
        this.defaultsCache!.remote,
        envInstances.length > 0 ? envInstances : this.extractInstances(this.instancesCache!.remote),
      );
      return;
    }

    const [defaultsRemote, instancesRemote] = await Promise.all([
      defaultsFresh
        ? Promise.resolve(this.defaultsCache!.remote)
        : this.fetchEffective<ScannerDefaultsJson>(SCANNER_DEFAULTS_POLICY_KEY),
      instancesFresh
        ? Promise.resolve(this.instancesCache!.remote)
        : this.fetchEffective<ScannerInstancesJson>(
            SCANNER_INSTANCES_POLICY_KEY,
          ),
    ]);

    this.defaultsCache = { at: now, remote: defaultsRemote };
    this.instancesCache = { at: now, remote: instancesRemote };
    this.resolved = this.mergeWithRemote(
      envDefaults,
      defaultsRemote,
      envInstances.length > 0 ? envInstances : this.extractInstances(instancesRemote),
    );
  }

  /**
   * Force a config refresh regardless of TTL. Audit-logged by the caller (S1-7 controller).
   * Exposed so an operator config change applies immediately.
   */
  async forceRefresh(): Promise<void> {
    this.defaultsCache = null;
    this.instancesCache = null;
    await this.ensureEffectiveConfigLoaded();
  }

  /** Current resolved defaults (env + remote merge). */
  getConfig(): ScannerResolvedConfig {
    return this.resolved;
  }

  /** All known instance definitions (enabled + disabled). */
  getInstances(): ScannerInstanceJson[] {
    return this.resolved.instances;
  }

  /** Enabled instances only — what the worker schedules timers for. */
  getEnabledInstances(): ScannerInstanceJson[] {
    return this.resolved.instances.filter((i) => i.enabled);
  }

  // --- env baseline --------------------------------------------------------

  private loadDefaultsFromEnv(): ScannerDefaultsResolved {
    const clampNonNeg = (n: number): number => (Number.isFinite(n) ? Math.max(0, n) : 0);
    return {
      findingsRetentionDays: Math.max(
        1,
        Number(
          process.env.SCANNER_FINDINGS_RETENTION_DAYS ??
            DEFAULT_SCANNER_FINDINGS_RETENTION_DAYS,
        ),
      ),
      rpcRateLimitRps: clampNonNeg(
        Number(
          process.env.SCANNER_RPC_RATE_LIMIT_RPS ??
            DEFAULT_SCANNER_RPC_RATE_LIMIT_RPS,
        ),
      ),
      poolCacheTtlMs: clampNonNeg(
        Number(
          process.env.SCANNER_POOL_CACHE_TTL_MS ??
            DEFAULT_SCANNER_POOL_CACHE_TTL_MS,
        ),
      ),
      dedupCooldownMs: clampNonNeg(
        Number(
          process.env.SCANNER_DEDUP_COOLDOWN_MS ?? DEFAULT_SCANNER_DEDUP_COOLDOWN_MS,
        ),
      ),
      orphanRetryIntervalMs: clampNonNeg(
        Number(
          process.env.SCANNER_ORPHAN_RETRY_INTERVAL_MS ??
            DEFAULT_SCANNER_ORPHAN_RETRY_INTERVAL_MS,
        ),
      ),
      orphanMaxAttempts: Math.max(
        0,
        Number(
          process.env.SCANNER_ORPHAN_MAX_ATTEMPTS ??
            DEFAULT_SCANNER_ORPHAN_MAX_ATTEMPTS,
        ),
      ),
      opportunityPublishTimeoutMs: clampNonNeg(
        Number(
          process.env.SCANNER_OPPORTUNITY_PUBLISH_TIMEOUT_MS ??
            DEFAULT_SCANNER_OPPORTUNITY_PUBLISH_TIMEOUT_MS,
        ),
      ),
      defaultFilters: {},
      configCacheTtlMs: this.resolvedDefaultsConfigCacheTtlMs(),
    };
  }

  private loadInstancesFromEnv(): ScannerInstanceJson[] {
    // No env override for the full instances array by design — instances are owned by
    // config-service. Returns [] so an unreachable/absent config-service yields an idle worker
    // rather than a fabricated scanner. (Env only tunes defaults / runtime knobs above.)
    return [];
  }

  private resolvedDefaultsConfigCacheTtlMs(): number {
    const raw = Number(
      process.env.SCANNER_CONFIG_CACHE_TTL_MS ??
        DEFAULT_SCANNER_CONFIG_CACHE_TTL_MS,
    );
    return Math.min(
      MAX_SCANNER_CONFIG_CACHE_TTL_MS,
      Math.max(MIN_SCANNER_CONFIG_CACHE_TTL_MS, raw),
    );
  }

  // --- remote fetch --------------------------------------------------------

  private buildConfigServiceBaseUrl(): string | null {
    const raw =
      process.env.CONFIG_SERVICE_URL?.trim() ||
      process.env.CONFIG_API_BASE?.trim() ||
      '';
    if (raw.length === 0) {
      return null;
    }
    return raw.replace(/\/$/, '');
  }

  /**
   * Fetch a `scanner.*` effective value from config-service.
   * Returns null on any error (no base URL, non-ok HTTP, missing/invalid JSON) —
   * non-fatal; caller falls back to env baseline.
   */
  private async fetchEffective<T>(key: string): Promise<T | null> {
    const base = this.buildConfigServiceBaseUrl();
    if (base === null) {
      this.logger.debug(
        `CONFIG_SERVICE_URL / CONFIG_API_BASE not set; ${key} uses env defaults only`,
      );
      return null;
    }

    const url = new URL(
      `${base}/policy/configurations/${encodeURIComponent(key)}/effective`,
    );
    const env = process.env.SCANNER_CONFIG_ENVIRONMENT?.trim();
    const tenant = process.env.SCANNER_CONFIG_TENANT_ID?.trim();
    if (env !== undefined && env.length > 0) {
      url.searchParams.set('environment', env);
    }
    if (tenant !== undefined && tenant.length > 0) {
      url.searchParams.set('tenantId', tenant);
    }

    try {
      const response = await signedFetch(url.toString(), { method: 'GET' });
      if (!response.ok) {
        this.logger.warn(
          `Effective config ${key} HTTP ${response.status}; using env fallback`,
        );
        return null;
      }
      const dto = (await response.json()) as { configValue?: string };
      if (dto.configValue === undefined || typeof dto.configValue !== 'string') {
        return null;
      }
      return JSON.parse(dto.configValue) as T;
    } catch (err) {
      this.logger.warn(
        `Failed to load effective ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  // --- merge ---------------------------------------------------------------

  private extractInstances(
    remote: ScannerInstancesJson | null,
  ): ScannerInstanceJson[] {
    if (remote === null || !Array.isArray(remote.instances)) {
      return [];
    }
    return remote.instances
      .filter((i): i is ScannerInstanceJson => i !== null && typeof i === 'object')
      .map((i) => ({
        ...i,
        // Clamp interval to a sane floor; also tolerate camelCase `intervalMs` from
        // a hand-edited config by normalizing to the canonical snake_case field.
        interval_ms: Math.max(
          MIN_SCANNER_INSTANCE_INTERVAL_MS,
          Number(i.interval_ms ?? (i as { intervalMs?: unknown }).intervalMs ?? 0),
        ),
      }));
  }

  private mergeWithRemote(
    envDefaults: ScannerDefaultsResolved,
    remoteDefaults: ScannerDefaultsJson | null,
    instances: ScannerInstanceJson[],
  ): ScannerResolvedConfig {
    const defaults: ScannerDefaultsResolved = { ...envDefaults };
    if (remoteDefaults !== null) {
      const pick = <K extends keyof ScannerDefaultsJson>(
        k: K,
        apply: (v: NonNullable<ScannerDefaultsJson[K]>) => void,
      ): void => {
        const v = remoteDefaults[k];
        if (v !== undefined && v !== null) apply(v);
      };
      pick('findingsRetentionDays', (v) => {
        if (Number.isFinite(v)) defaults.findingsRetentionDays = Math.max(1, v);
      });
      pick('rpcRateLimitRps', (v) => {
        if (Number.isFinite(v)) defaults.rpcRateLimitRps = Math.max(0, v);
      });
      pick('poolCacheTtlMs', (v) => {
        if (Number.isFinite(v)) defaults.poolCacheTtlMs = Math.max(0, v);
      });
      pick('dedupCooldownMs', (v) => {
        if (Number.isFinite(v)) defaults.dedupCooldownMs = Math.max(0, v);
      });
      pick('orphanRetryIntervalMs', (v) => {
        if (Number.isFinite(v)) defaults.orphanRetryIntervalMs = Math.max(0, v);
      });
      pick('orphanMaxAttempts', (v) => {
        if (Number.isFinite(v)) defaults.orphanMaxAttempts = Math.max(0, v);
      });
      pick('opportunityPublishTimeoutMs', (v) => {
        if (Number.isFinite(v)) defaults.opportunityPublishTimeoutMs = Math.max(0, v);
      });
      pick('defaultFilters', (v) => {
        defaults.defaultFilters = v;
      });
    }

    return { defaults, instances };
  }
}
