import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Counter, Gauge, Histogram } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import type { ExecutionLegEntity, ExecutionPlanEntity } from '@arbibot/persistence';

import type { VenueAdapter, VenueLegSubmitResult } from '../../venue/venue-adapter';
import { VenueSubmitClientError } from '../../venue/venue-adapter';
import { extractSwapParams, applySlippage, getSlippageBps, type DexSwapParams } from './uniswap-v2.adapter';

// ───────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────

/**
 * Simulated DEX swap result for paper trading.
 *
 * Contains all fields a real on-chain swap would produce,
 * but with simulated values — no actual blockchain transaction.
 */
export interface PaperDexSwapResult extends VenueLegSubmitResult {
  readonly simulated: true;
  readonly chainId: number;
  readonly amountIn: string;
  readonly amountOut: string;
  readonly amountOutMin: string;
  readonly gasUsed: number;
  readonly gasPriceGwei: number;
  readonly slippageBps: number;
  readonly path: readonly string[];
}

// ───────────────────────────────────────────────────────────────────────
// Environment helpers
// ───────────────────────────────────────────────────────────────────────

/** Simulated gas used per swap (default: 180000 — typical UniV2 swap). */
function readSimulatedGasUsed(): number {
  const raw = process.env.PAPER_DEX_SIMULATED_GAS_USED?.trim() ?? '';
  if (raw.length === 0) return 180_000;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 180_000;
}

/** Simulated gas price in Gwei (default: 0.1 — typical Arbitrum L2). */
function readSimulatedGasPriceGwei(): number {
  const raw = process.env.PAPER_DEX_SIMULATED_GAS_PRICE_GWEI?.trim() ?? '';
  if (raw.length === 0) return 0.1;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 0.1;
}

/**
 * Simulated output amount multiplier (default: 1.0 — no change).
 * Values > 1.0 simulate profit; < 1.0 simulate loss.
 */
function readSimulatedOutputMultiplier(): number {
  const raw = process.env.PAPER_DEX_SIMULATED_OUTPUT_MULTIPLIER?.trim() ?? '';
  if (raw.length === 0) return 1.0;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 1.0;
}

/**
 * Simulated price impact in basis points (default: 5 = 0.05%).
 * Applied before slippage — represents realistic market impact.
 */
function readSimulatedPriceImpactBps(): number {
  const raw = process.env.PAPER_DEX_SIMULATED_PRICE_IMPACT_BPS?.trim() ?? '';
  if (raw.length === 0) return 5;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 5;
}

// ───────────────────────────────────────────────────────────────────────
// Pure simulation helpers
// ───────────────────────────────────────────────────────────────────────

/**
 * Simulate DEX swap output amount.
 *
 * Formula:
 * 1. Start with `amountIn` as the "expected" output (1:1 baseline)
 * 2. Apply output multiplier (configurable for scenario testing)
 * 3. Apply price impact: `result = amount * (10000 - impactBps) / 10000`
 * 4. Apply slippage: `amountOutMin = result * (10000 - slippageBps) / 10000`
 *
 * The final `amountOut` is the "expected" output after price impact
 * (simulating what a real DEX would return via `getAmountsOut`).
 * The `amountOutMin` applies slippage protection on top.
 */
export function simulateSwapOutput(
  amountIn: string,
  slippageBps: number,
  outputMultiplier: number,
  priceImpactBps: number,
): { amountOut: string; amountOutMin: string } {
  const input = BigInt(amountIn);

  // Apply output multiplier (for scenario testing)
  const multiplied = (input * BigInt(Math.round(outputMultiplier * 10000))) / 10000n;

  // Apply price impact (simulates realistic market impact)
  const afterImpact = (multiplied * BigInt(10000 - priceImpactBps)) / 10000n;

  const amountOut = afterImpact.toString();
  const amountOutMin = applySlippage(amountOut, slippageBps);

  return { amountOut, amountOutMin };
}

/**
 * Calculate simulated gas cost in ETH.
 */
export function calculateSimulatedGasCostEth(
  gasUsed: number,
  gasPriceGwei: number,
): number {
  return (gasUsed * gasPriceGwei) / 1e9;
}

// ───────────────────────────────────────────────────────────────────────
// Adapter
// ───────────────────────────────────────────────────────────────────────

/**
 * Paper DEX venue adapter — simulates DEX swaps without on-chain execution.
 *
 * Implements `VenueAdapter.submitLeg()` by:
 * 1. Extracting `DexSwapParams` from `plan.playbookConfig.dexSwaps[legIndex]`
 * 2. Simulating swap output with configurable price impact and slippage
 * 3. Generating a deterministic `externalOrderId` prefixed with `paper-dex:`
 * 4. Recording Prometheus metrics for paper vs live comparison
 *
 * **Use case:** End-to-end testing of the DEX pipeline (opportunity → risk →
 * capital → arm → execution → fill tracking) without any mainnet risk.
 *
 * **Step:** DEX-1-3-PAPER-TESTNET
 *
 * **Configuration (env):**
 * - `PAPER_DEX_SIMULATED_GAS_USED` — gas per swap (default: 180000)
 * - `PAPER_DEX_SIMULATED_GAS_PRICE_GWEI` — gas price (default: 0.1)
 * - `PAPER_DEX_SIMULATED_OUTPUT_MULTIPLIER` — output multiplier (default: 1.0)
 * - `PAPER_DEX_SIMULATED_PRICE_IMPACT_BPS` — price impact bps (default: 5)
 */
@Injectable()
export class PaperDexAdapter implements VenueAdapter {
  private readonly logger = new Logger(PaperDexAdapter.name);

  // Metrics
  private swapCounter!: Counter<string>;
  private swapLatency!: Histogram<string>;
  private simulatedGasGauge!: Gauge<string>;
  private profitGauge!: Gauge<string>;

  constructor() {
    this.initializeMetrics();
  }

  /**
   * Simulate a DEX swap leg — no on-chain execution.
   *
   * Returns `PaperDexSwapResult` with simulated amounts, gas, and slippage.
   * Throws `VenueSubmitClientError` on validation failures (same as real adapters).
   */
  submitLeg(
    plan: ExecutionPlanEntity,
    leg: ExecutionLegEntity,
  ): Promise<VenueLegSubmitResult> {
    const timer = this.swapLatency.startTimer({ chain_id: 'unknown' });

    try {
      // 1. Extract swap parameters (same as real DEX adapters)
      const params = extractSwapParams(plan, leg);
      const chainLabel = String(params.chainId);

      this.logger.log(
        `submitLeg (PAPER): plan=${plan.id} leg=${leg.id} chain=${chainLabel} ` +
        `tokenIn=${params.tokenIn} tokenOut=${params.tokenOut} amountIn=${params.amountIn}`,
      );

      // 2. Validate basic swap params
      this.validateSwapParams(params);

      // 3. Simulate swap output
      const slippageBps = getSlippageBps(params.slippageBps);
      const outputMultiplier = readSimulatedOutputMultiplier();
      const priceImpactBps = readSimulatedPriceImpactBps();

      const { amountOut, amountOutMin } = simulateSwapOutput(
        params.amountIn,
        slippageBps,
        outputMultiplier,
        priceImpactBps,
      );

      // 4. Simulate gas
      const gasUsed = readSimulatedGasUsed();
      const gasPriceGwei = readSimulatedGasPriceGwei();
      const gasCostEth = calculateSimulatedGasCostEth(gasUsed, gasPriceGwei);

      // 5. Build swap path
      const swapPath = params.path ?? [params.tokenIn, params.tokenOut];

      // 6. Generate paper external order ID
      const externalOrderId = `paper-dex:${randomUUID()}`;

      this.logger.log(
        `submitLeg (PAPER): simulated swap plan=${plan.id} leg=${leg.id} ` +
        `amountOut=${amountOut} amountOutMin=${amountOutMin} ` +
        `gasUsed=${gasUsed} gasPrice=${gasPriceGwei}gwei gasCost=${gasCostEth.toFixed(6)}ETH ` +
        `slippageBps=${slippageBps} priceImpactBps=${priceImpactBps}`,
      );

      // 7. Record metrics
      timer({ chain_id: chainLabel });
      this.swapCounter.inc({ chain_id: chainLabel, status: 'success' });
      this.simulatedGasGauge.set(
        { chain_id: chainLabel },
        gasCostEth,
      );

      // Calculate simulated profit (amountOut - amountIn in "units")
      const profitDelta = BigInt(amountOut) - BigInt(params.amountIn);
      const profitUsd = Number(profitDelta) / 1e18; // Assume 18-decimal token
      this.profitGauge.set(
        { chain_id: chainLabel, venue: 'paper-dex' },
        profitUsd,
      );

      const result: PaperDexSwapResult = {
        externalOrderId,
        simulated: true,
        chainId: params.chainId,
        amountIn: params.amountIn,
        amountOut,
        amountOutMin,
        gasUsed,
        gasPriceGwei,
        slippageBps,
        path: swapPath,
      };

      return Promise.resolve(result);
    } catch (error) {
      if (error instanceof VenueSubmitClientError) {
        this.swapCounter.inc({ chain_id: 'unknown', status: 'validation_error' });
        return Promise.reject(error);
      }

      const message = error instanceof Error ? error.message : String(error);
      this.swapCounter.inc({ chain_id: 'unknown', status: 'error' });
      this.logger.error(`submitLeg (PAPER): unexpected error: ${message}`);
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      timer();
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal
  // ─────────────────────────────────────────────────────────────────────

  private validateSwapParams(params: DexSwapParams): void {
    const amountIn = BigInt(params.amountIn);
    if (amountIn <= 0n) {
      throw new VenueSubmitClientError(
        `PaperDexAdapter: amountIn must be positive, got ${params.amountIn}`,
        { category: 'validation' },
      );
    }

    if (params.tokenIn === params.tokenOut) {
      throw new VenueSubmitClientError(
        `PaperDexAdapter: tokenIn and tokenOut must differ (${params.tokenIn})`,
        { category: 'validation' },
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Metrics
  // ─────────────────────────────────────────────────────────────────────

  private initializeMetrics(): void {
    const registry = getArbibotMetricsRegistry();

    this.swapCounter = new Counter({
      name: 'arb_paper_dex_swap_total',
      help: 'Total paper DEX swap operations (simulated)',
      labelNames: ['chain_id', 'status'],
      registers: [registry],
    });

    this.swapLatency = new Histogram({
      name: 'arb_paper_dex_swap_latency_seconds',
      help: 'Paper DEX swap latency in seconds (simulation overhead only)',
      labelNames: ['chain_id'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25],
      registers: [registry],
    });

    this.simulatedGasGauge = new Gauge({
      name: 'arb_paper_dex_simulated_gas_cost_eth',
      help: 'Simulated gas cost in ETH for paper DEX swaps',
      labelNames: ['chain_id'],
      registers: [registry],
    });

    this.profitGauge = new Gauge({
      name: 'arb_paper_dex_simulated_profit_usd',
      help: 'Simulated profit/loss in USD for paper DEX swaps (positive = profit)',
      labelNames: ['chain_id', 'venue'],
      registers: [registry],
    });
  }
}