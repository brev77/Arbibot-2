import { Injectable, Logger } from '@nestjs/common';
import { signedFetch } from '@arbibot/nest-platform';

import {
  DEFAULT_PAPER_AUTO_DRIVE_CONFIG_CACHE_MS,
  PAPER_AUTO_DRIVE_POLICY_KEY,
} from './auto-drive-config.constants';

/**
 * Resolved AutoDrive configuration (env baseline merged with remote config-service value).
 *
 * `enabled` is the kill-switch: `false` halts the worker entirely (also flipped to `false` by
 * `tools/panic-button.sh`). Default is **`false`** — safe-by-default; an operator must
 * explicitly opt in via env or config-service to start automated paper trading.
 */
export interface AutoDriveConfig {
  enabled: boolean;
  /** AutoDriveWorker tick interval (ms), clamped to ≥ 1000. */
  intervalMs: number;
  /** Skip promoted candidates with netProfitUsd below this (USD). */
  minNetProfitUsd: number;
  /** Hard cap on simultaneously active paper trades; Phase B is skipped at or above this count. */
  maxConcurrentTrades: number;
  /** Fixed notional (USD) used when creating a paper trade from a promoted candidate. */
  notionalUsd: number;
  /** Tick batch size (candidates / drafts / actives processed per phase per tick). */
  batchSize: number;
  /** Opt-in: auto-approve drafts (draft → active). Default false (operator still gates paper→live). */
  autoApprove: boolean;
  /** Opt-in: auto-promote queued candidates (queued → promoted). Default false (paper→live gate). */
  autoPromote: boolean;
  /** Min delay (ms) an active trade must age before auto-settle fires. */
  autoSettleDelayMs: number;
}

/**
 * JSON inside config-service `paper.auto_drive` value — all fields optional, override env only
 * when present and well-typed. See docs/paper-auto-drive-config-keys.md.
 */
export interface AutoDrivePolicyJson {
  enabled?: boolean;
  minNetProfitUsd?: number;
  maxConcurrentTrades?: number;
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
 * Resolves AutoDrive config from env (baseline) merged with config-service
 * `paper.auto_drive` effective value (pulled with TTL). Mirrors PaperDiscoveryService pattern.
 *
 * Single-writer: paper-trading-service is the only consumer of this key. Config-service stores
 * it (single-writer for `policy_configurations`); this service is a read-only consumer.
 */
@Injectable()
export class AutoDriveConfigService {
  private readonly logger = new Logger(AutoDriveConfigService.name);
  private config: AutoDriveConfig;
  private cache: { at: number; remote: AutoDrivePolicyJson | null } | null = null;

  constructor() {
    this.config = this.loadConfigFromEnv();
  }

  /** Current resolved config (env baseline merged with last fetched remote). */
  getConfig(): AutoDriveConfig {
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
      process.env.PAPER_AUTO_DRIVE_CONFIG_CACHE_MS,
      DEFAULT_PAPER_AUTO_DRIVE_CONFIG_CACHE_MS,
      5000,
    );
    const base = this.loadConfigFromEnv();
    const now = Date.now();

    if (this.cache !== null && now - this.cache.at < ttlMs) {
      this.config = this.applyRemoteJson(base, this.cache.remote);
      return;
    }

    let remote: AutoDrivePolicyJson | null = null;
    try {
      remote = await this.fetchEffectivePaperAutoDrive();
    } catch (err) {
      this.logger.warn(
        `Failed to load effective ${PAPER_AUTO_DRIVE_POLICY_KEY}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.cache = { at: now, remote };
    this.config = this.applyRemoteJson(base, remote);
  }

  private loadConfigFromEnv(): AutoDriveConfig {
    return {
      enabled: parseBooleanEnv(process.env.PAPER_AUTO_DRIVE_ENABLED, false),
      intervalMs: parsePositiveIntEnv(
        process.env.PAPER_AUTO_DRIVE_INTERVAL_MS,
        5000,
        1000,
      ),
      minNetProfitUsd: parseFiniteNumberEnv(
        process.env.PAPER_AUTO_DRIVE_MIN_NET_PROFIT_USD,
        5,
        0,
      ),
      maxConcurrentTrades: parsePositiveIntEnv(
        process.env.PAPER_AUTO_DRIVE_MAX_CONCURRENT_TRADES,
        20,
        0,
      ),
      notionalUsd: parseFiniteNumberEnv(
        process.env.PAPER_NOTIONAL_USD,
        1000,
        0,
      ),
      batchSize: parsePositiveIntEnv(
        process.env.PAPER_AUTO_DRIVE_BATCH_SIZE,
        10,
        1,
      ),
      autoApprove: parseBooleanEnv(process.env.PAPER_AUTO_APPROVE, false),
      autoPromote: parseBooleanEnv(process.env.PAPER_AUTO_PROMOTE, false),
      autoSettleDelayMs: parsePositiveIntEnv(
        process.env.PAPER_AUTO_SETTLE_DELAY_MS,
        5000,
        0,
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

  private async fetchEffectivePaperAutoDrive(): Promise<AutoDrivePolicyJson | null> {
    const base = this.buildConfigServiceBaseUrl();
    if (base === null) {
      this.logger.debug(
        'CONFIG_SERVICE_URL / CONFIG_API_BASE not set; paper auto-drive uses env only',
      );
      return null;
    }
    const url = new URL(
      `${base}/policy/configurations/${encodeURIComponent(PAPER_AUTO_DRIVE_POLICY_KEY)}/effective`,
    );
    const env = process.env.PAPER_AUTO_DRIVE_CONFIG_ENVIRONMENT?.trim();
    const tenant = process.env.PAPER_AUTO_DRIVE_CONFIG_TENANT_ID?.trim();
    if (env !== undefined && env.length > 0) {
      url.searchParams.set('environment', env);
    }
    if (tenant !== undefined && tenant.length > 0) {
      url.searchParams.set('tenantId', tenant);
    }
    const response = await signedFetch(url.toString(), { method: 'GET' });
    if (!response.ok) {
      this.logger.warn(
        `Effective config ${PAPER_AUTO_DRIVE_POLICY_KEY} HTTP ${response.status}; using env fallback`,
      );
      return null;
    }
    const dto = (await response.json()) as { configValue?: string };
    if (dto.configValue === undefined || typeof dto.configValue !== 'string') {
      return null;
    }
    try {
      return JSON.parse(dto.configValue) as AutoDrivePolicyJson;
    } catch {
      this.logger.warn(
        `${PAPER_AUTO_DRIVE_POLICY_KEY} configValue is not valid JSON; using env fallback`,
      );
      return null;
    }
  }

  private applyRemoteJson(base: AutoDriveConfig, remote: AutoDrivePolicyJson | null): AutoDriveConfig {
    const config: AutoDriveConfig = { ...base };
    if (remote === null) {
      return config;
    }
    if (typeof remote.enabled === 'boolean') {
      config.enabled = remote.enabled;
    }
    if (typeof remote.minNetProfitUsd === 'number' && Number.isFinite(remote.minNetProfitUsd)) {
      config.minNetProfitUsd = Math.max(0, remote.minNetProfitUsd);
    }
    if (typeof remote.maxConcurrentTrades === 'number' && Number.isFinite(remote.maxConcurrentTrades)) {
      config.maxConcurrentTrades = Math.max(0, Math.floor(remote.maxConcurrentTrades));
    }
    if (typeof remote.notionalUsd === 'number' && Number.isFinite(remote.notionalUsd)) {
      config.notionalUsd = Math.max(0, remote.notionalUsd);
    }
    return config;
  }
}
