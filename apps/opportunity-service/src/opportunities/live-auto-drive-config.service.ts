import { Injectable, Logger } from '@nestjs/common';
import { signedFetch } from '@arbibot/nest-platform';

import {
  DEFAULT_LIVE_AUTO_DRIVE_CONFIG_CACHE_MS,
  LIVE_AUTO_DRIVE_POLICY_KEY,
} from './live-auto-drive-config.constants';

/**
 * Resolved LiveAutoDrive configuration (env baseline merged with remote config-service value).
 *
 * `enabled` is the kill-switch: `false` halts the worker entirely (also flipped to `false` by
 * `tools/panic-button.sh`). Default is **`false`** — safe-by-default; an operator must
 * explicitly opt in via env or config-service to start automated live trading.
 *
 * Mirrors `paper-trading-service` AutoDriveConfigService (PLAN10 P10-1). All fields are
 * live-specific: lower defaults than paper ($50 notional vs $1000, maxConcurrentPlans 3 not 20)
 * because real money is at stake.
 */
export interface LiveAutoDriveConfig {
  enabled: boolean;
  /** LiveAutoDriveWorker tick interval (ms), clamped to ≥ 1000. */
  intervalMs: number;
  /** Skip risk_checked opportunities with netProfitUsd below this (USD). */
  minNetProfitUsd: number;
  /** Hard cap on simultaneously in-flight live plans (created but not completed). */
  maxConcurrentPlans: number;
  /** Fixed notional (USD) used per live plan. Tightened against dex.limits by the worker. */
  notionalUsd: number;
  /** Tick batch size (opportunities processed per tick). */
  batchSize: number;
}

/**
 * JSON inside config-service `live.auto_drive` value — all fields optional, override env only
 * when present and well-typed. See docs/live-auto-drive-config-keys.md (PLAN10).
 *
 * Note: `intervalMs`/`batchSize` are env-only (not remote-overridable), mirroring paper's
 * policy-json subset — operational knobs stay out of the policy store to avoid accidental
 * live-rate changes from /settings.
 */
export interface LiveAutoDrivePolicyJson {
  enabled?: boolean;
  minNetProfitUsd?: number;
  maxConcurrentPlans?: number;
  notionalUsd?: number;
}

function parseBooleanEnv(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') {
    return true;
  }
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') {
    return false;
  }
  return fallback;
}

function parsePositiveIntEnv(raw: string | undefined, fallback: number, min: number): number {
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(min, n);
}

function parseFiniteNumberEnv(raw: string | undefined, fallback: number, min: number): number {
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(min, n);
}

/**
 * Resolves LiveAutoDrive config from env (baseline) merged with config-service
 * `live.auto_drive` effective value (pulled with TTL). Mirrors the proven paper
 * AutoDriveConfigService pattern (paper-trading-service).
 *
 * Single-writer: opportunity-service is the only consumer of this key. Config-service stores
 * it (single-writer for `policy_configurations`); this service is a read-only consumer.
 */
@Injectable()
export class LiveAutoDriveConfigService {
  private readonly logger = new Logger(LiveAutoDriveConfigService.name);
  private config: LiveAutoDriveConfig;
  private cache: { at: number; remote: LiveAutoDrivePolicyJson | null } | null = null;

  constructor() {
    this.config = this.loadConfigFromEnv();
  }

  /** Current resolved config (env baseline merged with last fetched remote). */
  getConfig(): LiveAutoDriveConfig {
    return this.config;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Refresh effective config from config-service (TTL-cached). Call at the top of each worker tick.
   * Never throws: on fetch failure, falls back to env baseline.
   */
  async ensureEffectiveConfigLoaded(): Promise<void> {
    const ttlMs = parsePositiveIntEnv(
      process.env.LIVE_AUTO_DRIVE_CONFIG_CACHE_MS,
      DEFAULT_LIVE_AUTO_DRIVE_CONFIG_CACHE_MS,
      5000,
    );
    const base = this.loadConfigFromEnv();
    const now = Date.now();

    if (this.cache !== null && now - this.cache.at < ttlMs) {
      this.config = this.applyRemoteJson(base, this.cache.remote);
      return;
    }

    let remote: LiveAutoDrivePolicyJson | null = null;
    try {
      remote = await this.fetchEffectiveLiveAutoDrive();
    } catch (err) {
      this.logger.warn(
        `Failed to load effective ${LIVE_AUTO_DRIVE_POLICY_KEY}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.cache = { at: now, remote };
    this.config = this.applyRemoteJson(base, remote);
  }

  private loadConfigFromEnv(): LiveAutoDriveConfig {
    return {
      enabled: parseBooleanEnv(process.env.LIVE_AUTO_DRIVE_ENABLED, false),
      intervalMs: parsePositiveIntEnv(
        process.env.LIVE_AUTO_DRIVE_INTERVAL_MS,
        10_000,
        1000,
      ),
      minNetProfitUsd: parseFiniteNumberEnv(
        process.env.LIVE_AUTO_DRIVE_MIN_NET_PROFIT_USD,
        5,
        0,
      ),
      maxConcurrentPlans: parsePositiveIntEnv(
        process.env.LIVE_AUTO_DRIVE_MAX_CONCURRENT_PLANS,
        3,
        0,
      ),
      notionalUsd: parseFiniteNumberEnv(
        process.env.LIVE_NOTIONAL_USD,
        50,
        0,
      ),
      batchSize: parsePositiveIntEnv(
        process.env.LIVE_AUTO_DRIVE_BATCH_SIZE,
        1,
        1,
      ),
    };
  }

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

  private async fetchEffectiveLiveAutoDrive(): Promise<LiveAutoDrivePolicyJson | null> {
    const base = this.buildConfigServiceBaseUrl();
    if (base === null) {
      this.logger.debug(
        'CONFIG_SERVICE_URL / CONFIG_API_BASE not set; live auto-drive uses env only',
      );
      return null;
    }
    const url = new URL(
      `${base}/policy/configurations/${encodeURIComponent(LIVE_AUTO_DRIVE_POLICY_KEY)}/effective`,
    );
    const env = process.env.LIVE_AUTO_DRIVE_CONFIG_ENVIRONMENT?.trim();
    const tenant = process.env.LIVE_AUTO_DRIVE_CONFIG_TENANT_ID?.trim();
    if (env !== undefined && env.length > 0) {
      url.searchParams.set('environment', env);
    }
    if (tenant !== undefined && tenant.length > 0) {
      url.searchParams.set('tenantId', tenant);
    }
    const response = await signedFetch(url.toString(), { method: 'GET' });
    if (!response.ok) {
      this.logger.warn(
        `Effective config ${LIVE_AUTO_DRIVE_POLICY_KEY} HTTP ${response.status}; using env fallback`,
      );
      return null;
    }
    const dto = (await response.json()) as { configValue?: string };
    if (dto.configValue === undefined || typeof dto.configValue !== 'string') {
      return null;
    }
    try {
      return JSON.parse(dto.configValue) as LiveAutoDrivePolicyJson;
    } catch {
      this.logger.warn(
        `${LIVE_AUTO_DRIVE_POLICY_KEY} configValue is not valid JSON; using env fallback`,
      );
      return null;
    }
  }

  private applyRemoteJson(base: LiveAutoDriveConfig, remote: LiveAutoDrivePolicyJson | null): LiveAutoDriveConfig {
    const config: LiveAutoDriveConfig = { ...base };
    if (remote === null) {
      return config;
    }
    if (typeof remote.enabled === 'boolean') {
      config.enabled = remote.enabled;
    }
    if (typeof remote.minNetProfitUsd === 'number' && Number.isFinite(remote.minNetProfitUsd)) {
      config.minNetProfitUsd = Math.max(0, remote.minNetProfitUsd);
    }
    if (typeof remote.maxConcurrentPlans === 'number' && Number.isFinite(remote.maxConcurrentPlans)) {
      config.maxConcurrentPlans = Math.max(0, Math.floor(remote.maxConcurrentPlans));
    }
    if (typeof remote.notionalUsd === 'number' && Number.isFinite(remote.notionalUsd)) {
      config.notionalUsd = Math.max(0, remote.notionalUsd);
    }
    return config;
  }
}
