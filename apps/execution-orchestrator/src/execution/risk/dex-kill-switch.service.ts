import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Gauge } from 'prom-client';
import { getArbibotMetricsRegistry, signedFetch } from '@arbibot/nest-platform';

/**
 * DEX Live Kill-Switch (D4-B-1-KILLSWITCH, L1 critical).
 *
 * Halts all DEX live trading (DEX swaps + bridge legs) when active. The flag is
 * read from two sources, in precedence order:
 *   1. `DEX_LIVE_KILL_SWITCH` env override (operator emergency — takes effect
 *      on the next leg, no config-service round-trip). `true|1` → halt,
 *      `false|0` → explicitly NOT halted (overrides config), unset → defer.
 *   2. config-service `dex.limits.killSwitch` (seeded by migration 035,
 *      toggled via operator UI / API). Cached with a short TTL.
 *
 * Paper path is structurally unaffected: the gate is applied in `LegsService`
 * only to live legs (venueKey ∈ DEX_VENUE_KEYS) and bridge legs; paper-dex legs
 * never reach the check. See `docs/adr-live-gate.md` §1.
 *
 * Fail-state: in production, if the cache has never been populated AND no env
 * override is set → halt (fail-closed). In non-production → allow (so local
 * development works without a reachable config-service).
 */

const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_HTTP_TIMEOUT_MS = 3_000;
const METRIC_NAME = 'arb_dex_live_halt_active';

interface KillSwitchCache {
  value: boolean;
  fetchedAtMs: number;
}

interface FetchJsonResult {
  ok: boolean;
  status: number;
  body: unknown;
}

function configBaseUrl(): string {
  const url = (
    process.env.CONFIG_SERVICE_URL ??
    process.env.CONFIG_API_BASE ??
    'http://127.0.0.1:3019'
  ).replace(/\/$/, '');
  return url;
}

function cacheTtlMs(): number {
  const raw = process.env.DEX_KILL_SWITCH_CACHE_TTL_MS;
  if (raw === undefined || raw.length === 0) {
    return DEFAULT_CACHE_TTL_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CACHE_TTL_MS;
  }
  // Clamp 5s–300s. Kill-switch is operational — shorter floor than intake (61s).
  return Math.min(300_000, Math.max(5_000, parsed));
}

function httpTimeoutMs(): number {
  const raw = process.env.DEX_KILL_SWITCH_HTTP_TIMEOUT_MS;
  if (raw === undefined || raw.length === 0) {
    return DEFAULT_HTTP_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_HTTP_TIMEOUT_MS;
  }
  return Math.min(10_000, Math.max(500, parsed));
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Parse the `DEX_LIVE_KILL_SWITCH` env override.
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

/** Resilient JSON fetch with timeout. Never throws — returns {ok:false} on error. */
async function fetchJson(url: string, timeoutMs: number): Promise<FetchJsonResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
export class DexKillSwitchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DexKillSwitchService.name);
  private cache: KillSwitchCache | null = null;
  private inflight: Promise<void> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private haltGauge: Gauge | null = null;

  constructor() {
    this.initializeMetrics();
  }

  onModuleInit(): void {
    // Best-effort initial refresh; failure leaves cache null (fail-closed in prod).
    void this.refresh().catch((e: unknown) => {
      this.logger.warn(
        `initial kill-switch refresh failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    });
    // Periodic background refresh keeps the cache warm so the per-leg check is
    // an in-memory read (<5ms budget). .unref() so it never keeps the process alive.
    this.refreshTimer = setInterval(() => {
      void this.refresh().catch(() => {
        /* keep stale cache; logged in refresh() */
      });
    }, cacheTtlMs());
    this.refreshTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private initializeMetrics(): void {
    const registry = getArbibotMetricsRegistry();
    // Guard against double-registration in HMR / test re-instantiation.
    const existing = registry.getSingleMetric(METRIC_NAME);
    if (existing !== undefined) {
      this.haltGauge = existing as Gauge;
      return;
    }
    this.haltGauge = new Gauge({
      name: METRIC_NAME,
      help: 'DEX live execution kill-switch active (1=halted, 0=running)',
      registers: [registry],
    });
  }

  /**
   * Refresh the cached `dex.limits.killSwitch` from config-service. On failure,
   * the existing cache is retained (stale-but-available); if no cache exists,
   * it stays null (fail-closed in production).
   */
  async refresh(): Promise<void> {
    if (this.inflight !== null) {
      await this.inflight;
      return;
    }
    this.inflight = (async () => {
      const url = `${configBaseUrl()}/policy/configurations/dex.limits/effective`;
      const result = await fetchJson(url, httpTimeoutMs());
      if (!result.ok || result.body === null || typeof result.body !== 'object') {
        this.logger.warn(
          `dex.limits effective fetch failed (status=${result.status}); retaining ${this.cache !== null ? 'stale cache' : 'no cache'}`,
        );
        return;
      }
      // config-service returns configValue as a JSON-encoded STRING.
      const body = result.body as { configValue?: unknown };
      const raw = body.configValue;
      if (typeof raw !== 'string' || raw.length === 0) {
        this.logger.warn(
          'dex.limits effective returned non-string configValue; retaining cache',
        );
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        this.logger.warn('dex.limits configValue is not valid JSON; retaining cache');
        return;
      }
      const killSwitch =
        parsed !== null &&
        typeof parsed === 'object' &&
        'killSwitch' in parsed &&
        typeof (parsed as { killSwitch?: unknown }).killSwitch === 'boolean'
          ? (parsed as { killSwitch: boolean }).killSwitch
          : false;
      this.cache = { value: killSwitch, fetchedAtMs: Date.now() };
    })();
    try {
      await this.inflight;
    } finally {
      this.inflight = null;
    }
  }

  /**
   * Whether DEX live trading is currently halted. Resolution:
   *   1. `DEX_LIVE_KILL_SWITCH` env override (if set).
   *   2. cached `dex.limits.killSwitch` (refreshed if stale).
   *   3. fail-closed: in production with no resolvable value → halt; else allow.
   */
  async isLiveHalted(): Promise<boolean> {
    const envOverride = parseEnvOverride();
    if (envOverride !== null) {
      this.emitGauge(envOverride);
      return envOverride;
    }

    // Refresh if stale (or never fetched). Best-effort: if refresh fails, the
    // existing (possibly stale) cache is used.
    if (this.cache === null || Date.now() - this.cache.fetchedAtMs > cacheTtlMs()) {
      await this.refresh().catch(() => {
        /* refresh logs; fall through to cache/fail-closed */
      });
    }

    if (this.cache !== null) {
      this.emitGauge(this.cache.value);
      return this.cache.value;
    }

    // Fail-closed in production; allow in non-prod (dev convenience).
    const halted = isProduction();
    this.emitGauge(halted);
    if (halted) {
      this.logger.error(
        'kill-switch cannot resolve state (cache empty, no env override) — FAIL-CLOSED (halting live). Set DEX_LIVE_KILL_SWITCH or ensure config-service is reachable.',
      );
    }
    return halted;
  }

  /**
   * Throw `ConflictException` if live trading is halted. Called before every
   * live leg broadcast in `LegsService.markSent`. The leg stays in `created`
   * state on throw, so it remains retryable once the halt clears.
   */
  async assertLiveNotHalted(): Promise<void> {
    if (await this.isLiveHalted()) {
      throw new ConflictException(
        'DEX live execution is halted (kill switch active). Clear dex.limits.killSwitch or DEX_LIVE_KILL_SWITCH to resume.',
      );
    }
  }

  /** Test-only: force a cache value without a network fetch. */
  setCacheForTest(value: boolean): void {
    this.cache = { value, fetchedAtMs: Date.now() };
  }

  private emitGauge(halted: boolean): void {
    this.haltGauge?.set(halted ? 1 : 0);
  }
}
