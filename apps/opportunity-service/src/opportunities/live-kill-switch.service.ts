import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { signedFetch } from '@arbibot/nest-platform';

/**
 * LiveKillSwitchService (PLAN10 P10-2, opp-service).
 *
 * The LiveAutoDriveWorker (opportunity-service) must verify the live kill-switch before
 * creating an execution plan, but `DexKillSwitchService` lives in the execution-orchestrator
 * module and cannot be injected here. This service is a read-only consumer of the same
 * `dex.limits.killSwitch` config row, replicating DexKillSwitchService's halt-state
 * resolution **1-в-1** so both services agree on whether live trading is halted.
 *
 * Resolution precedence (identical to DexKillSwitchService.isLiveHalted):
 *   1. `DEX_LIVE_KILL_SWITCH` env override (`'true'`/`'1'` → halt, `'false'`/`'0'` → allow,
 *      unset → defer to config)
 *   2. cached `dex.limits.killSwitch` boolean (TTL 30s)
 *   3. fail-closed in production (return true = halt); non-prod fails open (return false)
 *
 * Mirrors the lazy fetch/cache/fail-closed structure of CapitalLimitsService (capital-service),
 * which is the proven pattern for a config-reader that is NOT the original service.
 */

const CONFIG_CACHE_TTL_MS = 30_000; // 30s — matches DexKillSwitchService default
const HTTP_TIMEOUT_MS = 3_000;

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

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Parse the `DEX_LIVE_KILL_SWITCH` env override — identical to DexKillSwitchService.parseEnvOverride.
 *   - `'true'` / `'1'` → halt (overrides config)
 *   - `'false'` / `'0'` → explicitly allow (overrides config)
 *   - unset / anything else → `null` (defer to cached config)
 */
function parseEnvOverride(): boolean | null {
  const raw = process.env.DEX_LIVE_KILL_SWITCH;
  if (raw === undefined || raw.length === 0) {
    return null;
  }
  if (raw === 'true' || raw === '1') {
    return true;
  }
  if (raw === 'false' || raw === '0') {
    return false;
  }
  return null;
}

async function fetchJson(url: string): Promise<FetchJsonResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await signedFetch(url, {
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

@Injectable()
export class LiveKillSwitchService {
  private readonly logger = new Logger(LiveKillSwitchService.name);

  private cache: { value: boolean; fetchedAtMs: number } | null = null;
  private inflight: Promise<void> | null = null;

  /**
   * Resolve whether live execution is halted. Mirrors DexKillSwitchService.isLiveHalted
   * precedence exactly so both services compute identical halt state from the same env +
   * same `dex.limits/effective` config row.
   */
  async isLiveHalted(): Promise<boolean> {
    // 1. Env override (full override, not lower-bound — matches DexKillSwitchService).
    const envOverride = parseEnvOverride();
    if (envOverride !== null) {
      return envOverride;
    }

    // 2. Lazy refresh + cached config.
    if (this.cache === null || Date.now() - this.cache.fetchedAtMs > CONFIG_CACHE_TTL_MS) {
      await this.refresh().catch(() => {
        /* logged in refresh; fall through to cache / fail-closed */
      });
    }

    if (this.cache !== null) {
      return this.cache.value;
    }

    // 3. Fail-closed in prod (halt); fail-open in non-prod (allow) — matches DexKillSwitchService.
    if (isProduction()) {
      this.logger.error(
        'live kill-switch unresolved (config-service unreachable AND no DEX_LIVE_KILL_SWITCH env) — FAIL-CLOSED in production. Live auto-drive will not create plans.',
      );
      return true;
    }
    this.logger.warn(
      'live kill-switch unresolved — non-prod fails open (allow). Set DEX_LIVE_KILL_SWITCH or ensure config-service reachable.',
    );
    return false;
  }

  /**
   * Assert live is not halted. Throws ConflictException (maps to HTTP 409) when halted,
   * mirroring DexKillSwitchService.assertLiveNotHalted so the worker's failure handling
   * is symmetric with the per-leg check inside execution-orchestrator.
   */
  async assertLiveNotHalted(): Promise<void> {
    if (await this.isLiveHalted()) {
      throw new ConflictException('Live execution is halted (DEX_LIVE_KILL_SWITCH or dex.limits.killSwitch)');
    }
  }

  /** Force-refresh killSwitch from config-service (test/operation hook). */
  async refresh(): Promise<void> {
    if (this.inflight !== null) {
      await this.inflight;
      return;
    }
    this.inflight = (async () => {
      const url = `${configBaseUrl()}/policy/configurations/dex.limits/effective`;
      const res = await fetchJson(url);
      const parsed = this.parseResponse(res);
      if (parsed !== null) {
        this.cache = { value: parsed, fetchedAtMs: Date.now() };
      } else {
        this.logger.warn(
          `dex.limits effective fetch failed (status=${res.status}); retaining ${this.cache !== null ? 'stale cache' : 'no cache'}`,
        );
      }
    })();
    try {
      await this.inflight;
    } finally {
      this.inflight = null;
    }
  }

  /** Test-only: force a halt state without a network fetch. */
  setCacheForTest(value: boolean): void {
    this.cache = { value, fetchedAtMs: Date.now() };
  }

  // ── Parsing ───────────────────────────────────────────────────────────

  private parseResponse(res: FetchJsonResult): boolean | null {
    if (!res.ok || res.body === null || typeof res.body !== 'object') {
      return null;
    }
    const body = res.body as { configValue?: unknown };
    if (typeof body.configValue !== 'string' || body.configValue.length === 0) {
      return null;
    }
    let parsed: { killSwitch?: unknown };
    try {
      parsed = JSON.parse(body.configValue) as { killSwitch?: unknown };
    } catch {
      return null;
    }
    if (parsed === null || typeof parsed !== 'object') {
      return null;
    }
    // killSwitch defaults to false if absent/non-boolean — matches DexKillSwitchService.
    return typeof parsed.killSwitch === 'boolean' ? parsed.killSwitch : false;
  }
}
