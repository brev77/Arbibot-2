import { Injectable, Logger } from '@nestjs/common';
import { Counter, Histogram } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { ChainId, Address } from '@arbibot/contracts-eth';
import { DiscoveredPool } from '../pool/pool-discovery.service';

/**
 * Slippage estimate result
 */
export interface SlippageEstimate {
  estimatedBps: number;
  maxAcceptableBps: number;
  poolImpactBps: number;
  priceImpactBps: number;
  isAcceptable: boolean;
  recommendation: 'proceed' | 'reduce_size' | 'wait' | 'abort';
}

/**
 * Slippage Protection Service
 * Step: DEX-1-1-SLIPPAGE
 *
 * Estimates and validates slippage for DEX trades.
 * Uses pool reserves and trade size to calculate expected price impact.
 */
@Injectable()
export class SlippageProtectionService {
  private readonly logger = new Logger(SlippageProtectionService.name);

  // Default max slippage: 1% (100 bps)
  private readonly DEFAULT_MAX_SLIPPAGE_BPS = 100;
  // High slippage warning threshold: 0.5% (50 bps)
  private readonly WARNING_THRESHOLD_BPS = 50;

  // Metrics
  private estimateCounter!: Counter<string>;
  private blockedCounter!: Counter<string>;
  private slippageHistogram!: Histogram<string>;

  constructor() {
    this.initializeMetrics();
  }

  /**
   * Estimate slippage for a trade
   * Uses constant product formula (x * y = k) for UniV2-style pools
   */
  estimateSlippage(params: {
    pool: DiscoveredPool;
    amountIn: bigint;
    tokenIn: Address;
    chainId: ChainId;
    maxSlippageBps?: number;
  }): SlippageEstimate {
    const { pool, amountIn, tokenIn } = params;
    const maxBps = params.maxSlippageBps ?? this.DEFAULT_MAX_SLIPPAGE_BPS;

    // Determine which reserve is input
    const isToken0In = tokenIn.toLowerCase() === pool.token0.toLowerCase();
    const reserveIn = isToken0In ? pool.reserve0 : pool.reserve1;
    const reserveOut = isToken0In ? pool.reserve1 : pool.reserve0;

    // Calculate price impact using constant product formula
    // impact = (amountIn / (reserveIn + amountIn)) * 10000
    let priceImpactBps = 0;
    if (reserveIn > 0n) {
      // Scale to avoid precision loss: (amountIn * 10000) / (reserveIn + amountIn)
      const numerator = amountIn * 10000n;
      const denominator = reserveIn + amountIn;
      priceImpactBps = Number(numerator / denominator);
    }

    // Pool impact accounts for fee
    const feeBps = pool.feeBps;
    const poolImpactBps = priceImpactBps + feeBps;

    // Total estimated slippage
    const estimatedBps = poolImpactBps;

    // Determine if acceptable
    const isAcceptable = estimatedBps <= maxBps;

    // Recommendation
    let recommendation: SlippageEstimate['recommendation'];
    if (estimatedBps > maxBps * 2) {
      recommendation = 'abort';
    } else if (estimatedBps > maxBps) {
      recommendation = 'reduce_size';
    } else if (estimatedBps > this.WARNING_THRESHOLD_BPS) {
      recommendation = 'proceed'; // Within limits but high
    } else {
      recommendation = 'proceed';
    }

    // Record metrics
    this.slippageHistogram.observe({ chain_id: String(params.chainId) }, estimatedBps / 100);
    this.estimateCounter.inc({ chain_id: String(params.chainId) });

    if (!isAcceptable) {
      this.blockedCounter.inc({ chain_id: String(params.chainId) });
      this.logger.warn(
        `High slippage detected: ${estimatedBps} bps (max: ${maxBps}) for pool ${pool.address}`,
      );
    }

    return {
      estimatedBps,
      maxAcceptableBps: maxBps,
      poolImpactBps,
      priceImpactBps,
      isAcceptable,
      recommendation,
    };
  }

  /**
   * Calculate the maximum trade amount that stays within slippage limits
   */
  calculateMaxTradeAmount(params: {
    pool: DiscoveredPool;
    tokenIn: Address;
    maxSlippageBps?: number;
  }): bigint {
    const { pool, tokenIn } = params;
    const maxBps = params.maxSlippageBps ?? this.DEFAULT_MAX_SLIPPAGE_BPS;

    const isToken0In = tokenIn.toLowerCase() === pool.token0.toLowerCase();
    const reserveIn = isToken0In ? pool.reserve0 : pool.reserve1;

    // From: maxBps = (amountIn * 10000) / (reserveIn + amountIn)
    // Solve: amountIn = (reserveIn * maxBps) / (10000 - maxBps)
    if (maxBps >= 10000) {
      return reserveIn; // No limit effectively
    }

    const denominator = 10000 - maxBps;
    const maxAmount = (reserveIn * BigInt(maxBps)) / BigInt(denominator);

    return maxAmount;
  }

  /**
   * Initialize metrics
   */
  private initializeMetrics(): void {
    const registry = getArbibotMetricsRegistry();

    this.estimateCounter = new Counter({
      name: 'arb_dex_slippage_estimates_total',
      help: 'Total slippage estimates',
      labelNames: ['chain_id'],
      registers: [registry],
    });

    this.blockedCounter = new Counter({
      name: 'arb_dex_slippage_blocked_total',
      help: 'Total trades blocked due to excessive slippage',
      labelNames: ['chain_id'],
      registers: [registry],
    });

    this.slippageHistogram = new Histogram({
      name: 'arb_dex_slippage_bps',
      help: 'Estimated slippage in percent',
      labelNames: ['chain_id'],
      buckets: [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5],
      registers: [registry],
    });
  }
}