import { Injectable, Logger } from '@nestjs/common';
import { Counter } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { ChainId, Address } from '@arbibot/contracts-eth';
import { DiscoveredPool } from '../pool/pool-discovery.service';

/**
 * DEX Risk Policy Configuration
 */
export interface DexRiskPolicyConfig {
  maxSlippageBps: number;         // Maximum allowed slippage in basis points
  maxPositionSizeUsd: number;     // Maximum position size in USD
  minPoolLiquidityUsd: number;    // Minimum pool liquidity in USD
  maxGasPriceGwei: number;        // Maximum gas price
  allowedProtocols: string[];     // Allowed DEX protocols
  blockedTokens: Address[];       // Tokens that cannot be traded
  maxDailyVolumeUsd: number;      // Max daily DEX volume per chain
  requireApproval: boolean;       // Require operator approval for trades
}

/**
 * Risk check result
 */
export interface DexRiskCheckResult {
  allowed: boolean;
  reasons: string[];
  warnings: string[];
  estimatedSlippageBps: number;
  estimatedGasCostUsd: number;
  poolLiquidityUsd: number;
}

/**
 * DEX Risk Policy Service
 * Step: DEX-1-0-RISK-POLICIES
 *
 * Evaluates DEX trades against risk policies before execution.
 * Complements the existing risk-service with DEX-specific checks.
 */
@Injectable()
export class DexRiskPolicyService {
  private readonly logger = new Logger(DexRiskPolicyService.name);

  // Default policy config (can be overridden via config-service)
  private readonly defaultConfig: DexRiskPolicyConfig = {
    maxSlippageBps: 100,         // 1%
    maxPositionSizeUsd: 10000,
    minPoolLiquidityUsd: 50000,
    maxGasPriceGwei: 50,
    allowedProtocols: ['uniswap-v2', 'uniswap-v3', 'sushiswap'],
    blockedTokens: [],
    maxDailyVolumeUsd: 100000,
    requireApproval: false,
  };

  // Track daily volume per chain
  private readonly dailyVolume = new Map<ChainId, { date: string; volumeUsd: number }>();

  // Metrics
  private riskCheckCounter!: Counter<string>;
  private riskBlockCounter!: Counter<string>;

  constructor() {
    this.initializeMetrics();
  }

  /**
   * Evaluate a DEX trade against risk policies
   */
  evaluateTrade(params: {
    chainId: ChainId;
    pool: DiscoveredPool;
    amountInUsd: number;
    estimatedSlippageBps: number;
    estimatedGasCostUsd: number;
    tokenIn: Address;
    tokenOut: Address;
  }): DexRiskCheckResult {
    const config = this.getEffectiveConfig();
    const reasons: string[] = [];
    const warnings: string[] = [];

    // 1. Protocol check
    if (!config.allowedProtocols.includes(params.pool.protocol)) {
      reasons.push(`Protocol ${params.pool.protocol} not allowed`);
    }

    // 2. Blocked tokens check
    if (config.blockedTokens.includes(params.tokenIn) || config.blockedTokens.includes(params.tokenOut)) {
      reasons.push('Trade involves a blocked token');
    }

    // 3. Slippage check
    if (params.estimatedSlippageBps > config.maxSlippageBps) {
      reasons.push(`Slippage ${params.estimatedSlippageBps} bps exceeds max ${config.maxSlippageBps} bps`);
    }

    // 4. Position size check
    if (params.amountInUsd > config.maxPositionSizeUsd) {
      reasons.push(`Position size $${params.amountInUsd} exceeds max $${config.maxPositionSizeUsd}`);
    }

    // 5. Pool liquidity check (approximation)
    const poolLiquidityUsd = Number(params.pool.reserve0) * 2; // Simplified
    if (poolLiquidityUsd < config.minPoolLiquidityUsd) {
      warnings.push(`Pool liquidity ~$${poolLiquidityUsd} below recommended $${config.minPoolLiquidityUsd}`);
    }

    // 6. Daily volume check
    const dailyVol = this.getDailyVolume(params.chainId);
    if (dailyVol + params.amountInUsd > config.maxDailyVolumeUsd) {
      reasons.push(`Daily volume would exceed $${config.maxDailyVolumeUsd}`);
    }

    const allowed = reasons.length === 0;

    // Record metrics
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
   * Record executed trade volume for daily tracking
   */
  recordTradeVolume(chainId: ChainId, volumeUsd: number): void {
    const today = new Date().toISOString().split('T')[0]!;
    const entry = this.dailyVolume.get(chainId);

    if (!entry || entry.date !== today) {
      this.dailyVolume.set(chainId, { date: today, volumeUsd });
    } else {
      entry.volumeUsd += volumeUsd;
    }
  }

  /**
   * Get effective risk policy config
   * TODO: integrate with config-service for dynamic config
   */
  getEffectiveConfig(): DexRiskPolicyConfig {
    // Override from env vars if set
    const envOverrides: Partial<DexRiskPolicyConfig> = {};

    if (process.env.DEX_MAX_SLIPPAGE_BPS) {
      envOverrides.maxSlippageBps = parseInt(process.env.DEX_MAX_SLIPPAGE_BPS, 10);
    }
    if (process.env.DEX_MAX_POSITION_SIZE_USD) {
      envOverrides.maxPositionSizeUsd = parseInt(process.env.DEX_MAX_POSITION_SIZE_USD, 10);
    }
    if (process.env.DEX_MIN_POOL_LIQUIDITY_USD) {
      envOverrides.minPoolLiquidityUsd = parseInt(process.env.DEX_MIN_POOL_LIQUIDITY_USD, 10);
    }

    return { ...this.defaultConfig, ...envOverrides };
  }

  /**
   * Get daily volume for a chain
   */
  private getDailyVolume(chainId: ChainId): number {
    const today = new Date().toISOString().split('T')[0]!;
    const entry = this.dailyVolume.get(chainId);
    if (!entry || entry.date !== today) {
      return 0;
    }
    return entry.volumeUsd;
  }

  /**
   * Initialize metrics
   */
  private initializeMetrics(): void {
    const registry = getArbibotMetricsRegistry();

    this.riskCheckCounter = new Counter({
      name: 'arb_dex_risk_checks_total',
      help: 'Total DEX risk checks',
      labelNames: ['chain_id', 'result'],
      registers: [registry],
    });

    this.riskBlockCounter = new Counter({
      name: 'arb_dex_risk_blocks_total',
      help: 'Total DEX trades blocked by risk policy',
      labelNames: ['chain_id'],
      registers: [registry],
    });
  }
}