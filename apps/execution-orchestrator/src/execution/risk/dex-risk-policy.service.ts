import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Counter } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { DexDailyVolumeEntity } from '@arbibot/persistence';
import { ChainId, Address } from '@arbibot/contracts-eth';
import { DiscoveredPool } from '../pool/pool-discovery.service';

/**
 * DEX Risk Policy Configuration (D4-B-2-LIMITS, L2).
 *
 * Sourced from config-service `dex.limits` / `dex.live` effective (cached),
 * with env overrides acting as LOWER-BOUND only (env can tighten, never loosen
 * the config value). Safe defaults mirror migration 035 seed (enabled:false).
 */
export interface DexRiskPolicyConfig {
  enabled: boolean;                // dex.limits.enabled
  maxSlippageBps: number;          // dex.limits.maxSlippageBps
  maxPositionSizeUsd: number;      // dex.limits.maxNotionalPerTradeUsd
  minPoolLiquidityUsd: number;     // recommended pool liquidity (env-configurable)
  maxGasPriceGwei: number;         // per-chain chains[id].maxGasPriceGwei (default)
  allowedProtocols: string[];      // all 5 DEX protocols by default
  blockedTokens: Address[];        // tokens that cannot be traded
  maxDailyVolumeUsd: number;       // dex.limits.maxDailyNotionalUsd
  requireApproval: boolean;        // dex.limits.requireOperatorApprovalPerTrade
}

/** Parsed dex.live effective config. */
export interface DexLiveConfig {
  liveEnabled: boolean;
  paperParallelEnabled: boolean;
  chains: number[];
  dryRunMode: boolean;
}

/** Risk check result. */
export interface DexRiskCheckResult {
  allowed: boolean;
  reasons: string[];
  warnings: string[];
  estimatedSlippageBps: number;
  estimatedGasCostUsd: number;
  poolLiquidityUsd: number;
}

// ── Safe defaults (mirror migration 035 seed: everything disabled / minimal) ──
const SAFE_DEFAULT_CONFIG: DexRiskPolicyConfig = {
  enabled: false,
  maxSlippageBps: 50,
  maxPositionSizeUsd: 500,
  minPoolLiquidityUsd: 50_000,
  maxGasPriceGwei: 30,
  allowedProtocols: ['uniswap-v2', 'uniswap-v3', 'sushiswap', 'pancakeswap-v2', 'biswap'],
  blockedTokens: [],
  maxDailyVolumeUsd: 5_000,
  requireApproval: true,
};

const SAFE_DEFAULT_LIVE: DexLiveConfig = {
  liveEnabled: false,
  paperParallelEnabled: true,
  chains: [],
  dryRunMode: true,
};

const CONFIG_CACHE_TTL_MS = 10_000; // 10s — limits are operational, short TTL
const HTTP_TIMEOUT_MS = 3_000;
const METRIC_CHECK = 'arb_dex_risk_checks_total';
const METRIC_BLOCK = 'arb_dex_risk_blocks_total';

interface ParsedLimits {
  enabled?: unknown;
  maxNotionalPerTradeUsd?: unknown;
  maxDailyNotionalUsd?: unknown;
  maxSlippageBps?: unknown;
  killSwitch?: unknown;
  requireOperatorApprovalPerTrade?: unknown;
  requireTwoPersonApproval?: unknown;
  chains?: unknown;
}
interface ParsedLive {
  liveEnabled?: unknown;
  paperParallelEnabled?: unknown;
  chains?: unknown;
  dryRunMode?: unknown;
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
function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}
function asStringArray(v: unknown): string[] | undefined {
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : undefined;
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

/**
 * DEX Risk Policy Service (D4-B-2-LIMITS).
 *
 * Reads dex.limits / dex.live from config-service (cached), persists daily
 * traded volume to Postgres (survives restart), and evaluates live DEX trades
 * against the configured limits before broadcast. Paper path never calls
 * evaluateTrade (structural isolation via venueKey).
 */
@Injectable()
export class DexRiskPolicyService {
  private readonly logger = new Logger(DexRiskPolicyService.name);

  private limitsCache: { value: DexRiskPolicyConfig; fetchedAtMs: number } | null = null;
  private liveCache: { value: DexLiveConfig; fetchedAtMs: number } | null = null;
  private limitsInflight: Promise<void> | null = null;
  private liveInflight: Promise<void> | null = null;

  private riskCheckCounter!: Counter<string>;
  private riskBlockCounter!: Counter<string>;

  constructor(
    @InjectRepository(DexDailyVolumeEntity)
    private readonly volumeRepo: Repository<DexDailyVolumeEntity>,
  ) {
    this.initializeMetrics();
  }

  /**
   * Evaluate a DEX trade against risk policies. Async because daily-volume is
   * now read from Postgres (D4-B-2-LIMITS). Throws nothing — returns
   * `{ allowed: false, reasons }` on violation; the caller decides to throw.
   */
  async evaluateTrade(params: {
    chainId: ChainId;
    pool?: DiscoveredPool;
    amountInUsd: number;
    estimatedSlippageBps: number;
    estimatedGasCostUsd: number;
    tokenIn: Address;
    tokenOut: Address;
  }): Promise<DexRiskCheckResult> {
    const config = await this.getEffectiveConfig();
    const reasons: string[] = [];
    const warnings: string[] = [];

    // 1. Protocol check (pool optional — skip if absent).
    if (params.pool !== undefined && !config.allowedProtocols.includes(params.pool.protocol)) {
      reasons.push(`Protocol ${params.pool.protocol} not allowed`);
    }

    // 2. Blocked tokens check.
    if (
      config.blockedTokens.includes(params.tokenIn) ||
      config.blockedTokens.includes(params.tokenOut)
    ) {
      reasons.push('Trade involves a blocked token');
    }

    // 3. Slippage check.
    if (params.estimatedSlippageBps > config.maxSlippageBps) {
      reasons.push(
        `Slippage ${params.estimatedSlippageBps} bps exceeds max ${config.maxSlippageBps} bps`,
      );
    }

    // 4. Position size check (per-trade notional cap).
    if (params.amountInUsd > config.maxPositionSizeUsd) {
      reasons.push(
        `Position size $${params.amountInUsd} exceeds max $${config.maxPositionSizeUsd}`,
      );
    }

    // 5. Pool liquidity warning (only if pool supplied; USD estimate is the
    // caller's responsibility — D4-B-2b price oracle will populate it).
    const poolLiquidityUsd = 0;
    if (params.pool !== undefined) {
      // NOTE: accurate USD liquidity requires the price oracle (D4-B-2b); until
      // then this is a conservative 0, so the check downgrades to a warning only.
      if (poolLiquidityUsd < config.minPoolLiquidityUsd) {
        warnings.push(
          `Pool liquidity estimate unavailable / below recommended $${config.minPoolLiquidityUsd}`,
        );
      }
    }

    // 6. Daily volume check (DB-backed, survives restart).
    const dailyVol = await this.getDailyVolume(params.chainId);
    if (dailyVol + params.amountInUsd > config.maxDailyVolumeUsd) {
      reasons.push(
        `Daily volume $${dailyVol + params.amountInUsd} would exceed max $${config.maxDailyVolumeUsd}`,
      );
    }

    const allowed = reasons.length === 0;

    this.riskCheckCounter.inc({
      chain_id: String(params.chainId),
      result: allowed ? 'allowed' : 'blocked',
    });

    if (!allowed) {
      this.riskBlockCounter.inc({ chain_id: String(params.chainId) });
      this.logger.warn(`DEX trade blocked: ${reasons.join('; ')}`);
    }

    return {
      allowed,
      reasons,
      warnings,
      estimatedSlippageBps: params.estimatedSlippageBps,
      estimatedGasCostUsd: params.estimatedGasCostUsd,
      poolLiquidityUsd,
    };
  }

  /**
   * Record executed trade volume (USD) for daily tracking. Atomic UPSERT —
   * race-safe without FOR UPDATE. Called by each DEX adapter after a successful
   * swap (D4-B-2d wiring).
   */
  async recordTradeVolume(chainId: ChainId, volumeUsd: number): Promise<void> {
    if (volumeUsd <= 0) {
      return;
    }
    const today = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
    try {
      // ON CONFLICT composite-key UPSERT: increment atomically.
      await this.volumeRepo.query(
        `INSERT INTO dex_daily_volume (chain_id, for_date, volume_usd, trade_count)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (chain_id, for_date) DO UPDATE
           SET volume_usd = dex_daily_volume.volume_usd + EXCLUDED.volume_usd,
               trade_count = dex_daily_volume.trade_count + 1`,
        [chainId, today, volumeUsd],
      );
    } catch (e) {
      this.logger.error(
        `recordTradeVolume failed (chain=${chainId}, usd=${volumeUsd}): ${e instanceof Error ? e.message : String(e)}`,
      );
      // Non-fatal for the swap itself (already broadcast); log + metric.
    }
  }

  /**
   * Effective risk policy config: config-service dex.limits (cached) merged with
   * env LOWER-BOUND overrides (env can only tighten). Safe defaults on fetch
   * failure (fail-closed: enabled=false, minimal caps).
   */
  async getEffectiveConfig(): Promise<DexRiskPolicyConfig> {
    if (this.limitsCache === null || Date.now() - this.limitsCache.fetchedAtMs > CONFIG_CACHE_TTL_MS) {
      await this.refreshLimits().catch(() => {
        /* logged in refresh; fall through to cache/defaults */
      });
    }
    const base = this.limitsCache?.value ?? SAFE_DEFAULT_CONFIG;
    return this.applyEnvLowerBounds(base);
  }

  /** Effective dex.live config (cached). */
  async getEffectiveLiveConfig(): Promise<DexLiveConfig> {
    if (this.liveCache === null || Date.now() - this.liveCache.fetchedAtMs > CONFIG_CACHE_TTL_MS) {
      await this.refreshLive().catch(() => {
        /* fall through to cache/defaults */
      });
    }
    return this.liveCache?.value ?? SAFE_DEFAULT_LIVE;
  }

  /** Force-refresh dex.limits from config-service (test/operation hook). */
  async refreshLimits(): Promise<void> {
    if (this.limitsInflight !== null) {
      await this.limitsInflight;
      return;
    }
    this.limitsInflight = (async () => {
      const url = `${configBaseUrl()}/policy/configurations/dex.limits/effective`;
      const res = await fetchJson(url);
      const parsed = this.parseLimitsResponse(res);
      if (parsed !== null) {
        this.limitsCache = { value: parsed, fetchedAtMs: Date.now() };
      } else {
        this.logger.warn(
          `dex.limits effective fetch failed (status=${res.status}); retaining ${this.limitsCache !== null ? 'stale cache' : 'safe defaults'}`,
        );
      }
    })();
    try {
      await this.limitsInflight;
    } finally {
      this.limitsInflight = null;
    }
  }

  /** Force-refresh dex.live from config-service. */
  async refreshLive(): Promise<void> {
    if (this.liveInflight !== null) {
      await this.liveInflight;
      return;
    }
    this.liveInflight = (async () => {
      const url = `${configBaseUrl()}/policy/configurations/dex.live/effective`;
      const res = await fetchJson(url);
      const parsed = this.parseLiveResponse(res);
      if (parsed !== null) {
        this.liveCache = { value: parsed, fetchedAtMs: Date.now() };
      } else {
        this.logger.warn(
          `dex.live effective fetch failed (status=${res.status}); retaining ${this.liveCache !== null ? 'stale cache' : 'safe defaults'}`,
        );
      }
    })();
    try {
      await this.liveInflight;
    } finally {
      this.liveInflight = null;
    }
  }

  /** Test-only: force a config value without a network fetch. */
  setLimitsCacheForTest(value: DexRiskPolicyConfig): void {
    this.limitsCache = { value, fetchedAtMs: Date.now() };
  }

  // ── Parsing ───────────────────────────────────────────────────────────

  private parseLimitsResponse(res: FetchJsonResult): DexRiskPolicyConfig | null {
    if (!res.ok || res.body === null || typeof res.body !== 'object') {
      return null;
    }
    const body = res.body as { configValue?: unknown };
    if (typeof body.configValue !== 'string' || body.configValue.length === 0) {
      return null;
    }
    let parsed: ParsedLimits;
    try {
      parsed = JSON.parse(body.configValue) as ParsedLimits;
    } catch {
      return null;
    }
    if (parsed === null || typeof parsed !== 'object') {
      return null;
    }
    return {
      enabled: asBool(parsed.enabled, SAFE_DEFAULT_CONFIG.enabled),
      maxSlippageBps: asNumber(parsed.maxSlippageBps, SAFE_DEFAULT_CONFIG.maxSlippageBps),
      maxPositionSizeUsd: asNumber(parsed.maxNotionalPerTradeUsd, SAFE_DEFAULT_CONFIG.maxPositionSizeUsd),
      minPoolLiquidityUsd: SAFE_DEFAULT_CONFIG.minPoolLiquidityUsd, // not in config; env-only
      maxGasPriceGwei: SAFE_DEFAULT_CONFIG.maxGasPriceGwei, // per-chain; env-only for now
      allowedProtocols: SAFE_DEFAULT_CONFIG.allowedProtocols, // all 5 by default
      blockedTokens: SAFE_DEFAULT_CONFIG.blockedTokens,
      maxDailyVolumeUsd: asNumber(parsed.maxDailyNotionalUsd, SAFE_DEFAULT_CONFIG.maxDailyVolumeUsd),
      requireApproval: asBool(
        parsed.requireOperatorApprovalPerTrade ?? parsed.requireTwoPersonApproval,
        SAFE_DEFAULT_CONFIG.requireApproval,
      ),
    };
  }

  private parseLiveResponse(res: FetchJsonResult): DexLiveConfig | null {
    if (!res.ok || res.body === null || typeof res.body !== 'object') {
      return null;
    }
    const body = res.body as { configValue?: unknown };
    if (typeof body.configValue !== 'string' || body.configValue.length === 0) {
      return null;
    }
    let parsed: ParsedLive;
    try {
      parsed = JSON.parse(body.configValue) as ParsedLive;
    } catch {
      return null;
    }
    if (parsed === null || typeof parsed !== 'object') {
      return null;
    }
    const chainsRaw = asStringArray(parsed.chains);
    return {
      liveEnabled: asBool(parsed.liveEnabled, SAFE_DEFAULT_LIVE.liveEnabled),
      paperParallelEnabled: asBool(parsed.paperParallelEnabled, SAFE_DEFAULT_LIVE.paperParallelEnabled),
      chains: chainsRaw !== undefined ? chainsRaw.map((c) => Number.parseInt(c, 10)).filter((n) => Number.isFinite(n)) : [],
      dryRunMode: asBool(parsed.dryRunMode, SAFE_DEFAULT_LIVE.dryRunMode),
    };
  }

  /**
   * Env overrides as LOWER-BOUND: env can only TIGHTEN a limit (smaller cap,
   * stricter slippage), never loosen it. For non-cap fields (allowedProtocols,
   * blockedTokens) env is ignored — those come only from config-service.
   */
  private applyEnvLowerBounds(base: DexRiskPolicyConfig): DexRiskPolicyConfig {
    const out = { ...base };
    const envSlippage = process.env.DEX_MAX_SLIPPAGE_BPS;
    if (envSlippage !== undefined) {
      const v = Number.parseInt(envSlippage, 10);
      if (Number.isFinite(v)) {
        out.maxSlippageBps = Math.min(out.maxSlippageBps, v);
      }
    }
    const envPosition = process.env.DEX_MAX_POSITION_SIZE_USD;
    if (envPosition !== undefined) {
      const v = Number.parseInt(envPosition, 10);
      if (Number.isFinite(v)) {
        out.maxPositionSizeUsd = Math.min(out.maxPositionSizeUsd, v);
      }
    }
    const envLiquidity = process.env.DEX_MIN_POOL_LIQUIDITY_USD;
    if (envLiquidity !== undefined) {
      const v = Number.parseInt(envLiquidity, 10);
      if (Number.isFinite(v)) {
        out.minPoolLiquidityUsd = Math.max(out.minPoolLiquidityUsd, v); // higher bar = stricter
      }
    }
    return out;
  }

  // ── Daily volume (Postgres-backed) ────────────────────────────────────

  private async getDailyVolume(chainId: ChainId): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);
    try {
      const row = await this.volumeRepo.findOne({
        where: { chainId, forDate: today },
      });
      if (row === null) {
        return 0;
      }
      const n = Number(row.volumeUsd);
      return Number.isFinite(n) ? n : 0;
    } catch (e) {
      this.logger.warn(
        `getDailyVolume failed (chain=${chainId}): ${e instanceof Error ? e.message : String(e)} — treating as 0`,
      );
      return 0;
    }
  }

  // ── Metrics ──────────────────────────────────────────────────────────

  private initializeMetrics(): void {
    const registry = getArbibotMetricsRegistry();
    this.riskCheckCounter =
      (registry.getSingleMetric(METRIC_CHECK) as Counter<string> | undefined) ??
      new Counter({
        name: METRIC_CHECK,
        help: 'Total DEX risk checks',
        labelNames: ['chain_id', 'result'],
        registers: [registry],
      });
    this.riskBlockCounter =
      (registry.getSingleMetric(METRIC_BLOCK) as Counter<string> | undefined) ??
      new Counter({
        name: METRIC_BLOCK,
        help: 'Total DEX trades blocked by risk policy',
        labelNames: ['chain_id'],
        registers: [registry],
      });
  }
}
