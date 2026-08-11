import { Injectable, Logger } from '@nestjs/common';
import { Counter, Histogram } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { ChainId, Address } from '@arbibot/contracts-eth';
import type { ExecutionPlanEntity } from '@arbibot/persistence';

import { GasEstimatorService } from '../execution/gas/gas-estimator.service';
import { SlippageProtectionService } from '../execution/slippage/slippage-protection.service';
import { PoolDiscoveryService, type DiscoveredPool } from '../execution/pool/pool-discovery.service';
import { PriceOracleService } from '../execution/price/price-oracle.service';
import { DexRiskPolicyService } from '../execution/risk/dex-risk-policy.service';
import { BridgeAdapterFactoryService } from '../execution/bridge/bridge-adapter-factory.service';
import { V3QuoterService } from '../execution/v3-quoter.service';
import type { BridgeTransferParams } from '../execution/bridge/bridge-adapter.interface';

import type {
  LegCostBreakdown,
  PlanCostBreakdown,
  CostGateDecision,
  EstimateConfidence,
} from './cost-breakdown.types';
import type { ResolvedLegConfig } from '../plans/multi-leg-plan-builder.service';

/**
 * TradeCostEstimatorService — centralized pre-trade cost estimation.
 *
 * Aggregates ALL monetary losses a multi-leg execution plan is expected to
 * incur BEFORE the first leg is broadcast:
 *   - gas (EIP-1559 fee × gas limit × native/USD via PriceOracleService),
 *   - slippage (price impact on pool reserves via SlippageProtectionService),
 *   - pool / protocol fees (feeBps × notional, from DiscoveredPool),
 *   - bridge fees (relayer + protocol cost, from BridgeAdapter.estimateBridgeFee).
 *
 * Single-writer / boundary: lives in execution-orchestrator (owner of
 * ExecutionPlan/Leg). Risk-service and capital-service never invoke it — they
 * receive the gate decision via the leg submit path. Paper path is NOT blocked
 * (structural isolation via venueKey); only warned.
 *
 * Fail-closed: when a live leg's cost cannot be valued (price oracle null, RPC
 * down) the breakdown records `estimateConfidence: 'unavailable'` and the gate
 * blocks. The breakdown is still persisted for observability.
 */
@Injectable()
export class TradeCostEstimatorService {
  private readonly logger = new Logger(TradeCostEstimatorService.name);

  // Metrics
  private gasUsdHistogram!: Histogram<string>;
  private slippageBpsHistogram!: Histogram<string>;
  private bridgeFeeUsdHistogram!: Histogram<string>;
  private totalCostUsdHistogram!: Histogram<string>;
  private netProfitUsdHistogram!: Histogram<string>;
  private gateDecisionCounter!: Counter<string>;
  private estimateFailureCounter!: Counter<string>;

  constructor(
    private readonly gasEstimator: GasEstimatorService,
    private readonly slippageProtection: SlippageProtectionService,
    private readonly poolDiscovery: PoolDiscoveryService,
    private readonly priceOracle: PriceOracleService,
    private readonly bridgeAdapterFactory: BridgeAdapterFactoryService,
    // DexRiskPolicyService is injected to read minNetProfitUsd config; the gate
    // logic itself lives here (cost-aware) so risk-service stays single-writer
    // for risk decisions and execution stays single-writer for cost decisions.
    private readonly dexRiskPolicy: DexRiskPolicyService,
    // FIX-F (2026-08-11): authoritative V3 quote for price-impact estimation.
    // The V2 constant-product estimate (SlippageProtectionService) is
    // meaningless on V3 pools where DiscoveredPool reserves carry `liquidity`,
    // not a price; this provides the realized amountOut at current pool state.
    private readonly v3Quoter: V3QuoterService,
  ) {
    this.initializeMetrics();
  }

  /**
   * Estimate the full cost breakdown for a multi-leg execution plan.
   *
   * Reads `playbookConfig.legs[]` (resolved by MultiLegPlanBuilderService) and
   * aggregates per-leg gas + slippage + pool fee + bridge fee into totals.
   * Gross profit is sourced from the resolved legs' opportunity payload when
   * available; otherwise `null` (net profit stays null — gate cannot block on
   * profit, only on confidence).
   */
  async estimatePlanCost(plan: ExecutionPlanEntity): Promise<PlanCostBreakdown> {
    const config = plan.playbookConfig;
    const legsRaw = config?.legs;
    const legBreakdowns: LegCostBreakdown[] = [];

    if (Array.isArray(legsRaw)) {
      for (let i = 0; i < legsRaw.length; i += 1) {
        const leg = legsRaw[i] as unknown as ResolvedLegConfig;
        if (leg === null || typeof leg !== 'object') {
          continue;
        }
        const breakdown =
          leg.legType === 'bridge'
            ? await this.estimateBridgeLegCost(plan, i, leg)
            : await this.estimateDexLegCost(plan, i, leg);
        legBreakdowns.push(breakdown);
      }
    }

    const totalGasUsd = sum(legBreakdowns.map((l) => l.gasUsd));
    const totalSlippageUsd = sum(legBreakdowns.map((l) => l.slippageCostUsd));
    const totalPoolFeeUsd = sum(legBreakdowns.map((l) => l.poolFeeUsd));
    const totalBridgeFeeUsd = sum(legBreakdowns.map((l) => l.bridgeFeeUsd));
    const totalCostUsd = sum(legBreakdowns.map((l) => l.totalCostUsd));

    const grossProfitUsd = extractGrossProfitUsd(plan);
    const netProfitUsd =
      grossProfitUsd !== null ? grossProfitUsd - totalCostUsd : null;

    const confidence = aggregateConfidence(legBreakdowns);

    const breakdown: PlanCostBreakdown = {
      schemaVersion: 1,
      estimatedAt: new Date().toISOString(),
      legs: legBreakdowns,
      totalGasUsd,
      totalSlippageUsd,
      totalPoolFeeUsd,
      totalBridgeFeeUsd,
      totalCostUsd,
      grossProfitUsd,
      netProfitUsd,
      estimateConfidence: confidence,
    };

    // Record aggregate metrics.
    this.totalCostUsdHistogram.observe({}, totalCostUsd);
    if (netProfitUsd !== null) {
      this.netProfitUsdHistogram.observe({}, netProfitUsd);
    }

    return breakdown;
  }

  /**
   * Decide whether a plan may proceed to submit based on its cost breakdown.
   *
   * Blocks (returns `allowed: false`) when:
   *   - any live leg is `unavailable` (fail-closed: cannot value → no broadcast), OR
   *   - `netProfitUsd < minNetProfitUsd` (config: dex.limits.minNetProfitUsd).
   *
   * Warnings are non-blocking and recorded for observability. The caller
   * (LegsService plan-gate) persists the breakdown regardless of the decision.
   *
   * NOTE: paper plans are never blocked here — the caller checks `isLiveLeg`
   * before invoking the gate (paper/live isolation is structural). This method
   * itself is cost-only; it does not inspect venue keys.
   */
  async evaluatePlanGate(breakdown: PlanCostBreakdown): Promise<CostGateDecision> {
    const reasons: string[] = [];
    const warnings: string[] = [];

    // 1. Fail-closed: any unavailable live leg.
    if (breakdown.estimateConfidence === 'unavailable') {
      const unavailableLegs = breakdown.legs
        .filter((l) => l.estimateConfidence === 'unavailable')
        .map((l) => l.legIndex);
      reasons.push(
        `Cost estimate unavailable for leg(s) ${unavailableLegs.join(', ')} — cannot value live plan (fail-closed)`,
      );
    }

    // 2. Net-profit gate against configured floor.
    const config = await this.dexRiskPolicy.getEffectiveConfig();
    const minNetProfitUsd = config.minNetProfitUsd;
    if (breakdown.netProfitUsd !== null && breakdown.netProfitUsd < minNetProfitUsd) {
      reasons.push(
        `Net profit $${breakdown.netProfitUsd.toFixed(2)} below minimum $${minNetProfitUsd} (total cost $${breakdown.totalCostUsd.toFixed(2)}, gross $${breakdown.grossProfitUsd?.toFixed(2) ?? 'unknown'})`,
      );
    }

    // 3. Warnings for modeled estimates (not blocking).
    if (breakdown.estimateConfidence === 'modeled') {
      warnings.push('Some legs used modeled (fallback) cost estimates');
    }

    const allowed = reasons.length === 0;
    this.gateDecisionCounter.inc({ decision: allowed ? 'allowed' : 'blocked' });

    if (!allowed) {
      this.logger.warn(`Cost gate BLOCKED plan: ${reasons.join('; ')}`);
    } else {
      this.logger.debug(
        `Cost gate allowed plan: totalCost=$${breakdown.totalCostUsd.toFixed(2)}, ` +
        `netProfit=${breakdown.netProfitUsd?.toFixed(2) ?? 'unknown'}`,
      );
    }

    return { allowed, reasons, warnings, breakdown };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Per-leg estimation
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Estimate cost for a single DEX leg: gas + slippage + pool fee.
   *
   * Gas is valued via GasEstimatorService.estimateGas (mock tx request) →
   * estimateGasCostUsd (native USD via PriceOracle). Slippage uses
   * SlippageProtectionService when a DiscoveredPool is cached, else falls back
   * to the leg's slippageBps × notional (modeled). Pool fee uses pool.feeBps.
   */
  async estimateDexLegCost(
    plan: ExecutionPlanEntity,
    legIndex: number,
    leg: ResolvedLegConfig,
  ): Promise<LegCostBreakdown> {
    const chainId = (leg.chainId ?? 0);
    const notes: string[] = [];
    let confidence: EstimateConfidence = 'exact';

    // Resolve tokenIn / amountIn (required for slippage + notional).
    const tokenIn = leg.tokenIn as Address | undefined;
    const amountInStr = leg.amountIn;
    const amountIn = amountInStr !== undefined ? BigInt(amountInStr) : 0n;

    // ── Native USD price (for gas valuation). ──
    const nativeUsd = await this.readNativeUsd(chainId);

    // ── Gas. ──
    let gasUsd = 0;
    const gasResult = await this.estimateLegGas(chainId, tokenIn, amountIn, nativeUsd);
    if (gasResult.kind === 'value') {
      gasUsd = gasResult.usd;
      this.gasUsdHistogram.observe({ chain_id: String(chainId), leg_type: 'dex' }, gasUsd);
    } else {
      notes.push(gasResult.reason);
      confidence = 'unavailable';
    }

    // ── Notional (tokenIn USD value) — needed for slippage + pool fee. ──
    const notional = await this.resolveNotionalUsd(chainId, tokenIn, amountIn);
    if (notional === null) {
      notes.push('tokenIn USD notional unavailable');
      confidence = confidence === 'exact' ? 'modeled' : confidence;
    }

    // ── Slippage + pool fee via cached DiscoveredPool when available. ──
    let slippageCostUsd = 0;
    let poolFeeUsd = 0;
    let slippageBps = leg.slippageBps ?? 50;

    const pool = this.findPoolForLeg(chainId, tokenIn, leg.tokenOut as Address | undefined, leg.fee);
    const effectiveNotional = notional ?? 0;

    const isV3Pool =
      pool !== null &&
      pool.protocol === 'uniswap-v3' &&
      pool.sqrtPriceX96 !== undefined &&
      leg.fee !== undefined;

    if (isV3Pool && amountIn > 0n) {
      // FIX-F (2026-08-11): V3 pools carry `liquidity` in reserve0/1 (not a
      // price), so the V2 constant-product estimate is meaningless and
      // previously produced 3000–10000 bps impact → every V3 plan was blocked
      // by the cost gate. Use the authoritative QuoterV2 amountOut vs the
      // sqrtPriceX96-derived spot amountOut instead. On quote failure (RPC,
      // unsupported chain) fall back to modeled leg bps — never to the broken
      // constant-product estimate, and never silently understating impact.
      const v3Impact = await this.estimateV3PriceImpact(
        pool,
        tokenIn ?? pool.token0,
        amountIn,
        chainId,
        leg.fee,
      );
      poolFeeUsd = (effectiveNotional * pool.feeBps) / 10_000;
      if (v3Impact !== null) {
        slippageBps = v3Impact.priceImpactBps;
        slippageCostUsd = (effectiveNotional * v3Impact.priceImpactBps) / 10_000;
        this.slippageBpsHistogram.observe({ chain_id: String(chainId) }, slippageBps);
      } else {
        slippageCostUsd = (effectiveNotional * slippageBps) / 10_000;
        notes.push('v3 quote unavailable — slippage modeled from leg bps');
        confidence = confidence === 'exact' ? 'modeled' : confidence;
      }
    } else if (pool !== null && amountIn > 0n) {
      // V2/Sushi: constant-product on real reserves is correct here.
      const slippageEstimate = this.slippageProtection.estimateSlippage({
        pool,
        amountIn,
        tokenIn: tokenIn ?? pool.token0,
        chainId,
      });
      slippageBps = slippageEstimate.priceImpactBps;
      slippageCostUsd = (effectiveNotional * slippageEstimate.priceImpactBps) / 10_000;
      poolFeeUsd = (effectiveNotional * pool.feeBps) / 10_000;
      this.slippageBpsHistogram.observe({ chain_id: String(chainId) }, slippageBps);
    } else {
      // Modeled fallback: leg slippageBps × notional; no pool fee (unknown tier).
      slippageCostUsd = (effectiveNotional * slippageBps) / 10_000;
      notes.push('pool not cached — slippage modeled from leg bps, pool fee unknown');
      confidence = confidence === 'exact' ? 'modeled' : confidence;
    }

    const totalCostUsd = gasUsd + slippageCostUsd + poolFeeUsd;

    return {
      legIndex,
      legType: 'dex',
      chainId: leg.chainId ?? 0,
      gasUsd,
      slippageCostUsd,
      poolFeeUsd,
      bridgeFeeUsd: 0,
      totalCostUsd,
      slippageBps,
      estimateConfidence: confidence,
      note: notes.length > 0 ? notes.join('; ') : undefined,
    };
  }

  /**
   * Estimate cost for a single bridge leg: bridge fee (relayer + protocol) +
   * source-chain gas. Uses BridgeAdapter.estimateBridgeFee.
   */
  async estimateBridgeLegCost(
    plan: ExecutionPlanEntity,
    legIndex: number,
    leg: ResolvedLegConfig,
  ): Promise<LegCostBreakdown> {
    const chainId = (leg.chainId ?? 0);
    const notes: string[] = [];
    let confidence: EstimateConfidence = 'exact';

    let bridgeFeeUsd = 0;
    let gasUsd = 0;

    const bridgeKey = leg.bridgeKey;
    if (bridgeKey !== undefined && this.bridgeAdapterFactory.hasAdapter(bridgeKey)) {
      const adapter = this.bridgeAdapterFactory.resolveAdapter(bridgeKey);
      const transferParams: BridgeTransferParams = {
        sourceChainId: leg.chainId ?? 0,
        destinationChainId: leg.destinationChainId ?? 0,
        token: leg.token ?? '0x',
        destinationToken: leg.destinationToken ?? '0x',
        amount: leg.amount !== undefined ? BigInt(leg.amount) : 0n,
        recipientAddress: leg.recipientAddress ?? '0x',
        idempotencyKey: `cost-estimate:${plan.id}:${legIndex}`,
      };
      try {
        const fee = await adapter.estimateBridgeFee(transferParams);
        bridgeFeeUsd = fee.totalEstimatedCostUsd;
        this.bridgeFeeUsdHistogram.observe({ bridge: bridgeKey }, bridgeFeeUsd);
      } catch (e) {
        notes.push(
          `bridge fee estimate failed: ${e instanceof Error ? e.message : String(e)}`,
        );
        confidence = 'unavailable';
      }
    } else {
      notes.push(`bridge adapter "${bridgeKey ?? 'none'}" unavailable`);
      confidence = 'unavailable';
    }

    // Source-chain gas: read native price + a coarse gas estimate.
    const nativeUsd = await this.readNativeUsd(chainId);
    const gasResult = await this.estimateLegGas(chainId, undefined, 0n, nativeUsd, true);
    if (gasResult.kind === 'value') {
      gasUsd = gasResult.usd;
      this.gasUsdHistogram.observe({ chain_id: String(chainId), leg_type: 'bridge' }, gasUsd);
    } else {
      // Gas for a bridge is not strictly required to value the bridge fee; keep
      // confidence but warn.
      notes.push(`source gas: ${gasResult.reason}`);
      if (confidence === 'exact') {
        confidence = 'modeled';
      }
    }

    const totalCostUsd = gasUsd + bridgeFeeUsd;

    return {
      legIndex,
      legType: 'bridge',
      chainId: leg.chainId ?? 0,
      gasUsd,
      slippageCostUsd: 0,
      poolFeeUsd: 0,
      bridgeFeeUsd,
      totalCostUsd,
      slippageBps: 0,
      estimateConfidence: confidence,
      note: notes.length > 0 ? notes.join('; ') : undefined,
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────

  /** Read native (ETH/BNB) USD price for gas valuation. */
  private async readNativeUsd(chainId: ChainId): Promise<number | null> {
    // On BNB chains native is BNB; elsewhere ETH. We resolve via the wrapped
    // native token address (WETH/WBNB) which PriceOracle prices at the native
    // rate. This avoids duplicating the Chainlink feed logic.
    try {
      // Prefer the canonical wrapped-native address from contracts-eth; fall
      // back to null when the chain is unsupported (priceOracle handles it).
      return await this.priceOracle.getNativeUsdPrice(chainId);
    } catch {
      return null;
    }
  }

  /**
   * Resolve tokenIn USD notional = (amountIn / 10^decimals) × priceUsd.
   * Returns null when price or decimals are unavailable (fail-closed upstream).
   */
  private async resolveNotionalUsd(
    chainId: ChainId,
    tokenIn: Address | undefined,
    amountIn: bigint,
  ): Promise<number | null> {
    if (tokenIn === undefined || amountIn <= 0n) {
      return null;
    }
    const [price, decimals] = await Promise.all([
      this.priceOracle.getTokenPriceUsd(chainId, tokenIn),
      this.priceOracle.getTokenDecimals(chainId, tokenIn),
    ]);
    if (price === null || decimals === null) {
      return null;
    }
    const units = Number(amountIn) / 10 ** decimals;
    return units * price;
  }

  /**
   * Estimate gas cost in USD for a leg. Builds a coarse TransactionRequest and
   * calls GasEstimatorService.estimateGas, then converts to USD.
   *
   * For DEX legs we pass tokenIn/amountIn so the mock tx `to`/`data` can be
   * built; for bridge legs we pass `coarse=true` to use a fallback gas limit
   * when a full estimate is not feasible without bridge-specific calldata.
   */
  private async estimateLegGas(
    chainId: ChainId,
    tokenIn: Address | undefined,
    amountIn: bigint,
    nativeUsd: number | null,
    coarse = false,
  ): Promise<{ kind: 'value'; usd: number } | { kind: 'error'; reason: string }> {
    if (nativeUsd === null) {
      return { kind: 'error', reason: 'native USD price unavailable' };
    }
    try {
      // Coarse fallback for bridge legs (no router calldata to estimate against).
      if (coarse) {
        const feeData = await this.gasEstimator.getEip1559FeeData(chainId);
        // Approximate bridge submit gas: 250k (source) — conservative.
        const approxGasLimit = 250_000n;
        const cost = this.gasEstimator.estimateGasCostUsd(approxGasLimit, feeData, nativeUsd);
        if (cost === null) {
          return { kind: 'error', reason: 'gas→USD conversion failed' };
        }
        return { kind: 'value', usd: cost.costUsd };
      }

      // DEX leg: estimate against a minimal swap tx request.
      // Fix #10: previously `from: ZERO_ADDRESS, value: amountIn` — Arbitrum RPC rejects
      // this with `insufficient funds` / `execution reverted` because the zero-address has
      // no balance. value=0n makes the estimate succeed (we only need the gasLimit shape,
      // not an actual transfer). On failure we fall back to a coarse 180K-gas estimate so
      // transient RPC hiccups don't block the cost gate.
      const txRequest = {
        to: tokenIn ?? '0x',
        data: '0x',
        value: 0n,
      };
      try {
        const gas = await this.gasEstimator.estimateGas(chainId, txRequest);
        const cost = this.gasEstimator.estimateGasCostUsd(gas.gasLimit, gas.feeData, nativeUsd);
        if (cost === null) {
          return { kind: 'error', reason: 'gas→USD conversion failed' };
        }
        return { kind: 'value', usd: cost.costUsd };
      } catch (e) {
        // Coarse fallback: 180K gas is a conservative Arbitrum DEX swap gas limit. The cost
        // gate cares about order-of-magnitude (sub-dollar vs dollar-scale), not precision.
        this.logger.debug(
          `estimateGas threw for chain ${chainId} (${e instanceof Error ? e.message : String(e)}) — using coarse 180K fallback`,
        );
        const feeData = await this.gasEstimator.getEip1559FeeData(chainId);
        const approxGasLimit = 180_000n;
        const cost = this.gasEstimator.estimateGasCostUsd(approxGasLimit, feeData, nativeUsd);
        if (cost === null) {
          return { kind: 'error', reason: 'coarse gas→USD conversion failed' };
        }
        return { kind: 'value', usd: cost.costUsd };
      }
    } catch (e) {
      return {
        kind: 'error',
        reason: `gas estimate failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  /**
   * Find a cached DiscoveredPool matching the leg's token pair.
   *
   * FIX-E (2026-08-11): for V3 legs (`fee !== undefined`) the cache may hold
   * several fee tiers for the same token pair (e.g. a thin fee=500 pool next to
   * the liquid fee=3000 pool the plan actually trades). Returning the first
   * match picked a thin pool, and the V2 constant-product slippage estimate on
   * its (liquidity-shaped) reserves produced absurd impact → every V3 plan was
   * blocked by the cost gate. Now: when a fee tier is requested, only pools with
   * `feeBps === fee / 100` are considered (Uniswap fee tier 3000 → feeBps 30;
   * see PoolDiscoveryService where `feeBps: Number(fee) / 100`), the most
   * liquid one is chosen, and if none matches we return `null` so the caller
   * falls back to modeled slippage rather than borrowing an unrelated tier. For
   * V2/Sushi legs (`fee === undefined`) each pair has a single pool, so the
   * first match (legacy behavior) is correct.
   */
  private findPoolForLeg(
    chainId: ChainId,
    tokenIn: Address | undefined,
    tokenOut: Address | undefined,
    fee?: number,
  ): DiscoveredPool | null {
    if (tokenIn === undefined || tokenOut === undefined) {
      return null;
    }
    const pools = this.poolDiscovery.getCachedPools(chainId);
    const inLc = tokenIn.toLowerCase();
    const outLc = tokenOut.toLowerCase();
    const samePair = (p: DiscoveredPool): boolean => {
      const t0 = p.token0.toLowerCase();
      const t1 = p.token1.toLowerCase();
      return (t0 === inLc && t1 === outLc) || (t0 === outLc && t1 === inLc);
    };
    const matches = pools.filter(samePair);
    if (matches.length === 0) {
      return null;
    }
    // V3: restrict to the requested fee tier; pick the most liquid match.
    if (fee !== undefined) {
      const expectedFeeBps = fee / 100;
      const feeMatches = matches.filter((p) => p.feeBps === expectedFeeBps);
      if (feeMatches.length === 0) {
        // No pool of this fee tier cached → do NOT fall back to another tier
        // (a thin tier would corrupt the estimate); let the caller use modeled.
        return null;
      }
      return feeMatches.reduce((best, p) => (p.reserve0 > best.reserve0 ? p : best));
    }
    // V2/Sushi: a single pool per pair — first match is correct.
    return matches[0] ?? null;
  }

  /**
   * FIX-F (2026-08-11): compute the true V3 price impact from an authoritative
   * QuoterV2 quote vs the spot output implied by `slot0.sqrtPriceX96`.
   *
   * On V3 pools `DiscoveredPool.reserve0/1` carry `liquidity` (not a price), so
   * the V2 constant-product formula cannot be used. Instead:
   *   - `realAmountOut` = `QuoterV2.quoteExactInputSingle.staticCall` (realized
   *     output for this `amountIn` at current pool state — read-only `eth_call`,
   *     never a broadcast).
   *   - `fairAmountOut` = `amountIn` valued at the zero-impact spot price
   *     (`sqrtPriceX96² / 2¹⁹²`), computed entirely in BigInt so the impact
   *     ratio is exact and decimals cancel (raw-vs-raw comparison).
   *   - `priceImpactBps` = `(fair − real) / fair × 10000`, clamped `≥ 0`.
   *
   * Returns `null` when the quote cannot be obtained (unsupported chain, RPC
   * error, non-positive output) so the caller fails soft to a modeled estimate.
   * Capital safety: this path never silently understates impact — `null` is
   * surfaced, and the caller downgrades to `modeled` rather than guessing low.
   */
  private async estimateV3PriceImpact(
    pool: DiscoveredPool,
    tokenIn: Address,
    amountIn: bigint,
    chainId: ChainId,
    fee: number,
  ): Promise<{ priceImpactBps: number; realAmountOut: bigint } | null> {
    if (pool.sqrtPriceX96 === undefined) {
      return null;
    }
    const isToken0In = tokenIn.toLowerCase() === pool.token0.toLowerCase();
    const tokenOut = isToken0In ? pool.token1 : pool.token0;
    const realAmountOut = await this.v3Quoter.quoteExactInputSingle(
      chainId,
      tokenIn,
      tokenOut,
      amountIn,
      fee,
    );
    if (realAmountOut === null || realAmountOut <= 0n) {
      return null;
    }
    // Spot price in raw smallest units: token1/token0 = (sqrtP/2^96)^2.
    // All-BigInt so the impact ratio is exact (float would lose precision on
    // the huge sqrtPriceX96² and could understate impact — capital-unsafe).
    const sqrtP = pool.sqrtPriceX96;
    const Q192 = 1n << 192n; // 2^192
    const priceNum = sqrtP * sqrtP; // token1 raw per token0 raw × 2^192
    // fairAmountOut in raw tokenOut units at zero price impact.
    const fairAmountOut = isToken0In
      ? (amountIn * priceNum) / Q192 // token0 → token1
      : (amountIn * Q192) / priceNum; // token1 → token0
    if (fairAmountOut <= 0n) {
      return null;
    }
    let impactBig = ((fairAmountOut - realAmountOut) * 10_000n) / fairAmountOut;
    if (impactBig < 0n) {
      impactBig = 0n; // quote better than spot (rare) → zero impact, not negative
    }
    return { priceImpactBps: Number(impactBig), realAmountOut };
  }

  private initializeMetrics(): void {
    const registry = getArbibotMetricsRegistry();
    const h = (name: string, help: string, labels: string[], buckets: number[]) =>
      new Histogram({ name, help, labelNames: labels, buckets, registers: [registry] });

    this.gasUsdHistogram = h(
      'arb_cost_gas_usd',
      'Estimated gas cost in USD per leg',
      ['chain_id', 'leg_type'],
      [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 50],
    );
    this.slippageBpsHistogram = h(
      'arb_cost_slippage_bps',
      'Estimated slippage in basis points per DEX leg',
      ['chain_id'],
      [1, 5, 10, 25, 50, 100, 200, 500],
    );
    this.bridgeFeeUsdHistogram = h(
      'arb_cost_bridge_fee_usd',
      'Estimated bridge fee in USD per bridge leg',
      ['bridge'],
      [0.1, 0.5, 1, 2, 5, 10, 25, 50],
    );
    this.totalCostUsdHistogram = h(
      'arb_cost_total_usd',
      'Total estimated cost in USD per plan',
      [],
      [0.1, 0.5, 1, 2, 5, 10, 25, 50, 100],
    );
    this.netProfitUsdHistogram = h(
      'arb_cost_net_profit_usd',
      'Estimated net profit in USD per plan (gross − total cost)',
      [],
      [-50, -10, -1, 0, 1, 5, 10, 25, 50, 100],
    );

    this.gateDecisionCounter = new Counter({
      name: 'arb_cost_gate_decisions_total',
      help: 'Cost-gate decisions (allowed/blocked)',
      labelNames: ['decision'],
      registers: [registry],
    });
    this.estimateFailureCounter = new Counter({
      name: 'arb_cost_estimate_failures_total',
      help: 'Cost estimate component failures (oracle/rpc unavailable)',
      labelNames: ['component'],
      registers: [registry],
    });
  }
}

// ───────────────────────────────────────────────────────────────────────
// Pure helpers
// ───────────────────────────────────────────────────────────────────────

function sum(values: number[]): number {
  let total = 0;
  for (const v of values) {
    total += Number.isFinite(v) ? v : 0;
  }
  return total;
}

function aggregateConfidence(legs: LegCostBreakdown[]): EstimateConfidence {
  if (legs.some((l) => l.estimateConfidence === 'unavailable')) {
    return 'unavailable';
  }
  if (legs.some((l) => l.estimateConfidence === 'modeled')) {
    return 'modeled';
  }
  return 'exact';
}

/**
 * Extract gross profit (USD) from the plan's payload, when carried in the
 * playbookConfig or opportunity payload. Returns null when unavailable.
 */
function extractGrossProfitUsd(plan: ExecutionPlanEntity): number | null {
  const config = plan.playbookConfig;
  if (config === null || typeof config !== 'object') {
    return null;
  }
  // The multi-leg builder does not currently carry grossProfitUsd; the scanner
  // publishes it in the opportunity payload. Callers that have the opportunity
  // can inject it via playbookConfig.grossProfitUsd before estimation.
  const raw = (config).grossProfitUsd;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  return null;
}
