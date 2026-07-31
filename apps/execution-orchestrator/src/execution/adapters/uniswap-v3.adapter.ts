import { Injectable, Logger } from '@nestjs/common';
import { Contract, Interface, JsonRpcProvider, TransactionReceipt } from 'ethers';
import { Counter, Histogram } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import {
  Address,
  ChainId,
  ZERO_ADDRESS,
  UniswapV3RouterABI,
  QuoterV2ABI,
  getArbitrumAddresses,
  getBaseAddresses,
  getBnbAddresses,
} from '@arbibot/contracts-eth';
import type { ExecutionLegEntity, ExecutionPlanEntity } from '@arbibot/persistence';

import type { VenueAdapter, VenueLegSubmitResult } from '../../venue/venue-adapter';
import {
  VenueSubmitClientError,
  VenueSubmitTransientError,
  VenueTerminalSubmitError,
} from '../../venue/venue-adapter';
import { RpcProviderManager } from '../rpc/rpc-provider-manager.service';
import { WalletManagerService, type SelectedWallet } from '../wallet-manager.service';
import { GasEstimatorService } from '../gas/gas-estimator.service';
import { TokenApproveService } from '../token/token-approve.service';
import { DexRiskPolicyService } from '../risk/dex-risk-policy.service';
import { PriceOracleService } from '../price/price-oracle.service';
import {
  applySlippage,
  getSlippageBps,
  enforceLiveRiskGate,
  recordLiveTradeVolume,
} from './uniswap-v2.adapter';

// ───────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────

/**
 * DEX swap parameters for Uniswap V3 exactInputSingle.
 *
 * Unlike V2 which uses path-based routing, V3 requires a pool `fee` tier
 * and operates on a single pool (tokenIn/tokenOut with given fee).
 *
 * `amountOutExpected` is **required** — it comes from opportunity detection
 * and is used to compute `amountOutMinimum` via slippage tolerance when the
 * on-chain QuoterV2 quote is unavailable. When QuoterV2 is reachable, the
 * live quote supersedes `amountOutExpected` for `amountOutMinimum`.
 */
export interface DexSwapParamsV3 {
  /** Target chain ID */
  readonly chainId: ChainId;
  /** Token address to sell */
  readonly tokenIn: Address;
  /** Token address to buy */
  readonly tokenOut: Address;
  /** Pool fee tier in hundredths of a bip (uint24): 500=0.05%, 3000=0.3%, 10000=1% */
  readonly fee: number;
  /** Exact input amount in smallest token units (bigint string) */
  readonly amountIn: string;
  /**
   * Expected output amount from opportunity detection.
   * Used to compute `amountOutMinimum = amountOutExpected * (10000 - slippageBps) / 10000`.
   */
  readonly amountOutExpected: string;
  /** Slippage tolerance in basis points (overrides env default) */
  readonly slippageBps?: number;
  /** Recipient address (defaults to selected wallet) */
  readonly recipient?: Address;
  /** Deadline in seconds from now (default: 600 = 10 min) */
  readonly deadlineSeconds?: number;
  /**
   * SQRT price limit X96 (default: 0 = no limit).
   * Only set for directional swaps where price impact must be bounded.
   */
  readonly sqrtPriceLimitX96?: string;
}

// ───────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────

/** Default deadline in seconds from now (10 minutes). */
const DEFAULT_DEADLINE_SECONDS = 600;

/** Default pool fee tier: 3000 = 0.3%. */
const DEFAULT_FEE = 3000;

/**
 * Resolve V3 SwapRouter address for a given chainId.
 * Supports Arbitrum, Base, BNB Chain (mainnet + testnet).
 */
function resolveRouterAddress(chainId: ChainId): Address {
  // Arbitrum
  if (
    chainId === (42161 as ChainId) ||
    chainId === (421611 as ChainId) ||
    chainId === (421614 as ChainId)
  ) {
    return getArbitrumAddresses(chainId).uniswapV3Router;
  }
  // Base
  if (
    chainId === (8453 as ChainId) ||
    chainId === (84532 as ChainId)
  ) {
    return getBaseAddresses(chainId).uniswapV3Router;
  }
  // BNB Chain
  if (chainId === (56 as ChainId) || chainId === (97 as ChainId)) {
    return getBnbAddresses(chainId).uniswapV3Router;
  }
  throw new VenueSubmitClientError(
    `UniswapV3Adapter: unsupported chainId ${chainId}`,
    { category: 'validation' },
  );
}

/**
 * Resolve the V3 QuoterV2 address for a given chainId.
 *
 * Returns `ZERO_ADDRESS` on chains/testnets where QuoterV2 is not deployed
 * (all testnets) — the caller treats ZERO_ADDRESS as "quote unavailable" and
 * falls back to `amountOutExpected` from detection. This keeps the live gate
 * fail-closed: a missing quote never silently widens the slippage bound.
 */
function resolveQuoterV2Address(chainId: ChainId): Address {
  if (
    chainId === (42161 as ChainId) ||
    chainId === (421611 as ChainId) ||
    chainId === (421614 as ChainId)
  ) {
    return getArbitrumAddresses(chainId).quoterV2;
  }
  if (chainId === (8453 as ChainId) || chainId === (84532 as ChainId)) {
    return getBaseAddresses(chainId).quoterV2;
  }
  if (chainId === (56 as ChainId) || chainId === (97 as ChainId)) {
    return getBnbAddresses(chainId).quoterV2;
  }
  return ZERO_ADDRESS;
}

/** Minimal QuoterV2 surface used for `quoteExactInputSingle`. */
interface QuoterV2Contract {
  quoteExactInputSingle(params: {
    readonly tokenIn: string;
    readonly tokenOut: string;
    readonly amountIn: bigint;
    readonly fee: number;
    readonly sqrtPriceLimitX96: bigint;
  }): Promise<[bigint, bigint, number, bigint]>;
}

/**
 * Extract DexSwapParamsV3 from plan playbookConfig.
 *
 * Layout (mirrors `extractSwapParams`, D4-B-2c):
 * 1. `plan.playbookConfig.legs[leg.legIndex]` — multi-leg builder format
 * 2. `plan.playbookConfig.dexSwaps[leg.legIndex]` — legacy per-leg format
 *
 * `amountOutExpected` is required for V3. `fee` defaults to 3000 (0.3%) when
 * absent. Throws `VenueSubmitClientError` if neither layout yields valid params.
 */
function extractSwapParamsV3(
  plan: ExecutionPlanEntity,
  leg: ExecutionLegEntity,
): DexSwapParamsV3 {
  const config = plan.playbookConfig;
  if (!config || typeof config !== 'object') {
    throw new VenueSubmitClientError(
      `UniswapV3Adapter: plan ${plan.id} missing playbookConfig for DEX swap`,
      { category: 'validation' },
    );
  }

  // 1. Multi-leg format: config.legs[legIndex]
  const legs = config.legs;
  if (Array.isArray(legs)) {
    const legEntry = legs[leg.legIndex];
    if (legEntry && typeof legEntry === 'object') {
      const params = legEntry as Record<string, unknown>;
      const result = validateSwapParamsV3(params);
      if (result !== null) {
        return result;
      }
    }
  }

  // 2. Legacy dexSwaps[legIndex]
  const dexSwaps = config.dexSwaps;
  if (Array.isArray(dexSwaps)) {
    const params = dexSwaps[leg.legIndex] as Record<string, unknown> | undefined;
    if (params && typeof params === 'object') {
      const result = validateSwapParamsV3(params);
      if (result !== null) {
        return result;
      }
    }
  }

  throw new VenueSubmitClientError(
    `UniswapV3Adapter: no swap params for plan ${plan.id} leg ${leg.legIndex} — ` +
    `neither playbookConfig.legs[${leg.legIndex}] nor playbookConfig.dexSwaps[${leg.legIndex}] ` +
    `has valid {chainId, tokenIn, tokenOut, amountIn, amountOutExpected}`,
    { category: 'validation' },
  );
}

/**
 * Validate and build `DexSwapParamsV3` from a raw leg entry (used for both the
 * multi-leg `legs[]` and legacy `dexSwaps[]` shapes). Returns `null` if the
 * entry is missing required fields (caller falls through / throws).
 */
function validateSwapParamsV3(params: Record<string, unknown>): DexSwapParamsV3 | null {
  const chainId = params.chainId;
  const tokenIn = params.tokenIn;
  const tokenOut = params.tokenOut;
  const amountIn = params.amountIn;
  const amountOutExpected = params.amountOutExpected;

  if (
    typeof chainId !== 'number' ||
    typeof tokenIn !== 'string' ||
    typeof tokenOut !== 'string' ||
    typeof amountIn !== 'string' ||
    typeof amountOutExpected !== 'string'
  ) {
    return null;
  }

  // Validate fee is uint24 range
  const fee = typeof params.fee === 'number' ? params.fee : DEFAULT_FEE;
  if (fee < 0 || fee > 16777215 || !Number.isInteger(fee)) {
    throw new VenueSubmitClientError(
      `UniswapV3Adapter: fee must be uint24 (0–16777215), got ${fee}`,
      { category: 'validation' },
    );
  }

  return {
    chainId: chainId,
    tokenIn: tokenIn as Address,
    tokenOut: tokenOut as Address,
    fee,
    amountIn,
    amountOutExpected,
    slippageBps: typeof params.slippageBps === 'number' ? params.slippageBps : undefined,
    recipient: typeof params.recipient === 'string' ? (params.recipient as Address) : undefined,
    deadlineSeconds: typeof params.deadlineSeconds === 'number' ? params.deadlineSeconds : undefined,
    sqrtPriceLimitX96: typeof params.sqrtPriceLimitX96 === 'string' ? params.sqrtPriceLimitX96 : undefined,
  };
}

// ───────────────────────────────────────────────────────────────────────
// Adapter
// ───────────────────────────────────────────────────────────────────────

/**
 * Uniswap V3 DEX venue adapter using `exactInputSingle`.
 *
 * Implements `VenueAdapter.submitLeg()` by:
 * 1. Extracting `DexSwapParamsV3` from `plan.playbookConfig` (multi-leg `legs[]`
 *    first, then legacy `dexSwaps[]` — D4-B-2c)
 * 2. Ensuring ERC20 approval for the router
 * 3. Computing `amountOutMinimum` from `amountOutExpected` + slippage
 * 4. Estimating gas and checking policy
 * 5. Constructing and sending `exactInputSingle` on-chain
 * 6. Returning tx hash as `externalOrderId`
 *
 * **Step:** DEX-1-1-ADAPTER-UNI3
 */
@Injectable()
export class UniswapV3Adapter implements VenueAdapter {
  private readonly logger = new Logger(UniswapV3Adapter.name);

  /** Cached interface for encoding swap calldata */
  private readonly routerInterface = new Interface(UniswapV3RouterABI);

  // Metrics
  private swapCounter!: Counter<string>;
  private swapLatency!: Histogram<string>;
  private quoteFallbackCounter!: Counter<string>;

  constructor(
    private readonly rpcProviderManager: RpcProviderManager,
    private readonly walletManager: WalletManagerService,
    private readonly gasEstimator: GasEstimatorService,
    private readonly tokenApprove: TokenApproveService,
    private readonly dexRiskPolicy: DexRiskPolicyService,
    private readonly priceOracle: PriceOracleService,
  ) {
    this.initializeMetrics();
  }

  /**
   * Submit a DEX swap leg on-chain via Uniswap V3 `exactInputSingle`.
   *
   * Returns `{ externalOrderId: txHash }` on success.
   * Throws:
   * - `VenueSubmitClientError` on validation / approval / simulation revert
   * - `VenueSubmitTransientError` on RPC / network issues (retryable)
   * - `VenueTerminalSubmitError` when the swap definitively failed on-chain
   */
  async submitLeg(
    plan: ExecutionPlanEntity,
    leg: ExecutionLegEntity,
  ): Promise<VenueLegSubmitResult> {
    const timer = this.swapLatency.startTimer({ chain_id: 'unknown' });

    try {
      // 1. Extract swap parameters
      const params = extractSwapParamsV3(plan, leg);
      const chainLabel = String(params.chainId);

      this.logger.log(
        `submitLeg: plan=${plan.id} leg=${leg.id} chain=${chainLabel} ` +
        `tokenIn=${params.tokenIn} tokenOut=${params.tokenOut} ` +
        `amountIn=${params.amountIn} fee=${params.fee}`,
      );

      // 2. Resolve provider and router address
      const provider = this.rpcProviderManager.getProvider(params.chainId) as JsonRpcProvider;
      const routerAddress = resolveRouterAddress(params.chainId);

      // 2.5 D4-B-2d: live risk gate — evaluateTrade before wallet selection.
      // Fail-closed: unresolvable price/decimals or denied trade → throw, no broadcast.
      const { amountInUsd } = await enforceLiveRiskGate({
        dexRiskPolicy: this.dexRiskPolicy,
        priceOracle: this.priceOracle,
        gasEstimator: this.gasEstimator,
        adapterName: 'UniswapV3Adapter',
        chainId: params.chainId,
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn,
        slippageBps: params.slippageBps,
      });

      // 3. Select wallet
      const selectedWallet = await this.walletManager.selectWallet(
        params.chainId,
        provider,
        params.tokenIn,
        BigInt(params.amountIn),
      );

      // 4. Ensure ERC20 approval for the router
      await this.ensureApproval(params, selectedWallet, routerAddress);

      // 5. Calculate amountOutMinimum: live QuoterV2 quote (with fallback to
      //    detection-time amountOutExpected) + slippage tolerance.
      const { amountOutMin, usedLiveQuote } = await this.calculateAmountOutMin(params);

      this.logger.debug(
        `amountOutMin: expected=${params.amountOutExpected} minOut=${amountOutMin} liveQuote=${usedLiveQuote}`,
      );

      // 6. Estimate gas and check policy
      const recipient = params.recipient ?? selectedWallet.address;
      const deadline = Math.floor(Date.now() / 1000) + (params.deadlineSeconds ?? DEFAULT_DEADLINE_SECONDS);

      const txRequest = this.buildSwapTxRequest(
        routerAddress,
        params,
        amountOutMin,
        recipient,
        deadline,
        selectedWallet.address,
      );

      const gasEstimation = await this.gasEstimator.estimateGas(params.chainId, txRequest);

      if (!gasEstimation.withinPolicy) {
        throw new VenueSubmitClientError(
          `UniswapV3Adapter: gas price exceeds policy for chain ${params.chainId}: ` +
          `${gasEstimation.policyWarning}`,
          { category: 'semantic' },
        );
      }

      // 7. Submit transaction
      const tx = await selectedWallet.wallet.sendTransaction({
        ...txRequest,
        gasLimit: gasEstimation.gasLimit,
        maxFeePerGas: gasEstimation.feeData.maxFeePerGas,
        maxPriorityFeePerGas: gasEstimation.feeData.maxPriorityFeePerGas,
        type: 2, // EIP-1559
      });

      this.logger.log(
        `submitLeg: tx sent hash=${tx.hash} plan=${plan.id} leg=${leg.id} ` +
        `gasLimit=${gasEstimation.gasLimit} estimatedCost=${gasEstimation.estimatedCostEth} ETH`,
      );

      // 8. Wait for receipt (1 confirmation)
      const receipt: TransactionReceipt | null = await tx.wait(1);

      if (!receipt) {
        throw new VenueSubmitTransientError(
          `UniswapV3Adapter: tx ${tx.hash} returned null receipt (possible RPC issue)`,
        );
      }

      if (receipt.status === 0) {
        this.swapCounter.inc({ chain_id: chainLabel, status: 'reverted' });
        throw new VenueTerminalSubmitError(
          `UniswapV3Adapter: tx ${tx.hash} reverted on-chain (status=0)`,
          'failed',
        );
      }

      // 9. Success
      timer({ chain_id: chainLabel });
      this.swapCounter.inc({ chain_id: chainLabel, status: 'success' });

      this.logger.log(
        `submitLeg: confirmed hash=${tx.hash} gasUsed=${receipt.gasUsed.toString()} ` +
        `block=${receipt.blockNumber}`,
      );

      // D4-B-2d: record traded volume for daily-limit tracking (non-fatal).
      await recordLiveTradeVolume(this.dexRiskPolicy, params.chainId, amountInUsd);

      return {
        externalOrderId: tx.hash,
      };
    } catch (error) {
      if (
        error instanceof VenueSubmitClientError ||
        error instanceof VenueSubmitTransientError ||
        error instanceof VenueTerminalSubmitError
      ) {
        throw error;
      }

      // Wrap unexpected errors as transient (retryable)
      const message = error instanceof Error ? error.message : String(error);
      this.swapCounter.inc({ chain_id: 'unknown', status: 'error' });
      throw new VenueSubmitTransientError(
        `UniswapV3Adapter: unexpected error during submitLeg: ${message}`,
      );
    } finally {
      timer();
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal methods (public for testability)
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Ensure the router has sufficient ERC20 allowance.
   * Reuses the same approval logic as V2.
   */
  async ensureApproval(
    params: DexSwapParamsV3,
    selectedWallet: SelectedWallet,
    routerAddress: Address,
  ): Promise<void> {
    const amountIn = BigInt(params.amountIn);

    const currentAllowance = await this.tokenApprove.getAllowance({
      chainId: params.chainId,
      tokenAddress: params.tokenIn,
      owner: selectedWallet.address,
      spender: routerAddress,
    });

    if (currentAllowance >= amountIn) {
      this.logger.debug(
        `Sufficient allowance: ${currentAllowance} >= ${amountIn} for ${params.tokenIn} → ${routerAddress}`,
      );
      return;
    }

    this.logger.log(
      `Insufficient allowance (${currentAllowance} < ${amountIn}), approving ${params.tokenIn} for ${routerAddress}`,
    );

    const result = await this.tokenApprove.approveToken({
      chainId: params.chainId,
      tokenAddress: params.tokenIn,
      spender: routerAddress,
      amount: amountIn,
    });

    if (result.status === 'failed') {
      throw new VenueSubmitClientError(
        `UniswapV3Adapter: ERC20 approve failed for ${params.tokenIn} → ${routerAddress}: tx=${result.txHash}`,
        { category: 'semantic' },
      );
    }

    this.logger.log(`Approval confirmed: tx=${result.txHash}`);
  }

  /**
   * Calculate amountOutMinimum: prefer a live on-chain QuoterV2 quote, fall
   * back to the detection-time `amountOutExpected` when the Quoter is
   * unavailable (testnet / RPC error / ZERO_ADDRESS deployment).
   *
   * Returns `{ amountOutMin, usedLiveQuote }` so the caller can record the
   * fallback as a metric. Slippage tolerance (`slippageBps`) is applied in
   * both paths via `applySlippage`.
   */
  async calculateAmountOutMin(
    params: DexSwapParamsV3,
  ): Promise<{ amountOutMin: string; usedLiveQuote: boolean }> {
    const slippageBps = getSlippageBps(params.slippageBps);

    // Try live QuoterV2 first.
    const liveQuote = await this.quoteV3(params).catch((e: unknown) => {
      this.logger.warn(
        `QuoterV2 quote failed, falling back to amountOutExpected: ` +
        `${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    });

    if (liveQuote !== null) {
      return { amountOutMin: applySlippage(liveQuote, slippageBps), usedLiveQuote: true };
    }

    this.quoteFallbackCounter.inc({ chain_id: String(params.chainId), reason: 'fallback' });
    return {
      amountOutMin: applySlippage(params.amountOutExpected, slippageBps),
      usedLiveQuote: false,
    };
  }

  /**
   * Query the on-chain V3 QuoterV2 for the expected output of an
   * `exactInputSingle` swap. Returns the quoted `amountOut` as a bigint string,
   * or `null` when the Quoter is not deployed on the chain (ZERO_ADDRESS) or the
   * call reverts/returns non-positive (pool not initialized, wrong fee tier).
   *
   * The Quoter is a view contract (revert-and-catch internally), so calling it
   * costs no gas but still requires an `eth_call`. Best-effort: any failure
   * resolves to `null` and the caller falls back to `amountOutExpected`.
   */
  private async quoteV3(params: DexSwapParamsV3): Promise<string | null> {
    const quoterAddress = resolveQuoterV2Address(params.chainId);
    if (quoterAddress === ZERO_ADDRESS) {
      return null;
    }
    const provider = this.rpcProviderManager.getProvider(params.chainId);
    const quoter = new Contract(
      quoterAddress,
      QuoterV2ABI,
      provider,
    ) as unknown as QuoterV2Contract;

    const sqrtPriceLimitX96 = params.sqrtPriceLimitX96 ?? '0';
    const result = await quoter.quoteExactInputSingle({
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: BigInt(params.amountIn),
      fee: params.fee,
      sqrtPriceLimitX96: BigInt(sqrtPriceLimitX96),
    });
    const amountOut = result[0];
    if (amountOut === undefined || amountOut <= 0n) {
      return null;
    }
    return amountOut.toString();
  }

  /**
   * Build the transaction request object for `exactInputSingle`.
   *
   * Encodes the V3 struct parameter:
   * ```
   * ExactInputSingleParams {
   *   tokenIn, tokenOut, fee, recipient,
   *   amountIn, amountOutMinimum,
   *   sqrtPriceLimitX96
   * }
   * ```
   */
  buildSwapTxRequest(
    routerAddress: Address,
    params: DexSwapParamsV3,
    amountOutMin: string,
    recipient: Address,
    deadline: number,
    from: Address,
  ): {
    to: string;
    data: string;
    value: bigint;
    from: string;
  } {
    const sqrtPriceLimitX96 = params.sqrtPriceLimitX96 ?? '0';

    const data = this.routerInterface.encodeFunctionData('exactInputSingle', [
      {
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        fee: params.fee,
        recipient,
        amountIn: params.amountIn,
        amountOutMinimum: amountOutMin,
        sqrtPriceLimitX96,
      },
    ]);

    return {
      to: routerAddress,
      data,
      value: 0n,
      from,
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Metrics
  // ─────────────────────────────────────────────────────────────────────

  private initializeMetrics(): void {
    const registry = getArbibotMetricsRegistry();

    this.swapCounter = new Counter({
      name: 'arb_dex_uniswap_v3_swap_total',
      help: 'Total Uniswap V3 swap operations',
      labelNames: ['chain_id', 'status'],
      registers: [registry],
    });

    this.swapLatency = new Histogram({
      name: 'arb_dex_uniswap_v3_swap_latency_seconds',
      help: 'Uniswap V3 swap latency in seconds',
      labelNames: ['chain_id'],
      buckets: [0.5, 1, 2, 5, 10, 30, 60],
      registers: [registry],
    });

    this.quoteFallbackCounter = new Counter({
      name: 'arb_dex_v3_quote_fallback_total',
      help: 'V3 amountOutMin computations that fell back to detection-time amountOutExpected (QuoterV2 unavailable)',
      labelNames: ['chain_id', 'reason'],
      registers: [registry],
    });
  }
}