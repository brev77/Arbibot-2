import { Injectable, Logger } from '@nestjs/common';
import { Contract, Interface, JsonRpcProvider, TransactionReceipt } from 'ethers';
import { Counter, Histogram } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import {
  Address,
  ChainId,
  UniswapV2RouterABI,
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

// ───────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────

/**
 * DEX swap parameters extracted from plan/leg metadata.
 *
 * Resolved by `extractSwapParams` from either `plan.playbookConfig.legs[legIndex]`
 * (multi-leg builder format, D4-B-2c) or the legacy `dexSwaps[legIndex]` shape.
 * The adapter reads from this structure and does NOT invent default values for
 * missing fields.
 */
export interface DexSwapParams {
  /** Target chain ID */
  readonly chainId: ChainId;
  /** Token address to sell */
  readonly tokenIn: Address;
  /** Token address to buy */
  readonly tokenOut: Address;
  /** Exact input amount in smallest token units (bigint string) */
  readonly amountIn: string;
  /**
   * Swap path. Defaults to [tokenIn, tokenOut] when omitted.
   * Use longer paths for multi-hop (e.g. tokenIn → WETH → tokenOut).
   */
  readonly path?: readonly Address[];
  /** Slippage tolerance in basis points (overrides env default) */
  readonly slippageBps?: number;
  /** Recipient address (defaults to selected wallet) */
  readonly recipient?: Address;
  /** Deadline in seconds from now (default: 600 = 10 min) */
  readonly deadlineSeconds?: number;
}

/**
 * Result of a successful Uniswap V2 swap submission.
 * Extends VenueLegSubmitResult with on-chain details.
 */
export interface UniswapV2SwapResult extends VenueLegSubmitResult {
  readonly txHash: string;
  readonly chainId: ChainId;
  readonly amountIn: string;
  readonly amountOutMin: string;
  readonly path: readonly string[];
}

// ───────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────

/** Default deadline in seconds from now (10 minutes). */
const DEFAULT_DEADLINE_SECONDS = 600;

/** Default slippage tolerance: 50 bps (0.5%). Overridden by DEX_DEFAULT_SLIPPAGE_BPS env. */
const DEFAULT_SLIPPAGE_BPS = 50;

/**
 * Resolve router address for a given chainId.
 * Supports Arbitrum, Base, BNB Chain (mainnet + testnet).
 */
function resolveRouterAddress(chainId: ChainId): Address {
  // Arbitrum
  if (
    chainId === (42161 as ChainId) ||
    chainId === (421611 as ChainId) ||
    chainId === (421614 as ChainId)
  ) {
    return getArbitrumAddresses(chainId).uniswapV2Router;
  }
  // Base
  if (
    chainId === (8453 as ChainId) ||
    chainId === (84532 as ChainId)
  ) {
    return getBaseAddresses(chainId).uniswapV2Router;
  }
  // BNB Chain — PancakeSwap V2 compatible (same ABI as UniswapV2Router)
  if (chainId === (56 as ChainId) || chainId === (97 as ChainId)) {
    return getBnbAddresses(chainId).pancakeV2Router;
  }
  throw new VenueSubmitClientError(
    `UniswapV2Adapter: unsupported chainId ${chainId}`,
    { category: 'validation' },
  );
}

/**
 * Extract DexSwapParams from plan playbookConfig.
 *
 * Layout (mirrors `extractBridgeParams`, D4-B-2c):
 * 1. `plan.playbookConfig.legs[leg.legIndex]` — multi-leg builder format (chainId,
 *    tokenIn, tokenOut, amountIn, path, slippageBps, recipient, deadlineSeconds)
 * 2. `plan.playbookConfig.dexSwaps[leg.legIndex]` — legacy per-leg format
 *
 * Throws `VenueSubmitClientError` if neither layout yields the required fields.
 */
export function extractSwapParams(plan: ExecutionPlanEntity, leg: ExecutionLegEntity): DexSwapParams {
  const config = plan.playbookConfig;
  if (!config || typeof config !== 'object') {
    throw new VenueSubmitClientError(
      `UniswapV2Adapter: plan ${plan.id} missing playbookConfig for DEX swap`,
      { category: 'validation' },
    );
  }

  // 1. Multi-leg format: config.legs[legIndex]
  const legs = config.legs;
  if (Array.isArray(legs)) {
    const legEntry = legs[leg.legIndex];
    if (legEntry && typeof legEntry === 'object') {
      const params = legEntry as Record<string, unknown>;
      const result = validateSwapParams(params, plan.id, leg.legIndex, 'UniswapV2Adapter');
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
      const result = validateSwapParams(params, plan.id, leg.legIndex, 'UniswapV2Adapter');
      if (result !== null) {
        return result;
      }
    }
  }

  throw new VenueSubmitClientError(
    `UniswapV2Adapter: no swap params for plan ${plan.id} leg ${leg.legIndex} — ` +
    `neither playbookConfig.legs[${leg.legIndex}] nor playbookConfig.dexSwaps[${leg.legIndex}] ` +
    `has valid {chainId, tokenIn, tokenOut, amountIn}`,
    { category: 'validation' },
  );
}

/**
 * Validate and build `DexSwapParams` from a raw leg entry (used for both the
 * multi-leg `legs[]` and legacy `dexSwaps[]` shapes). Returns `null` if the
 * entry is missing required fields (so the caller can fall through to the next
 * layout); returns a validated `DexSwapParams` on success.
 */
function validateSwapParams(
  params: Record<string, unknown>,
  planId: string,
  legIndex: number,
  adapterName: string,
): DexSwapParams | null {
  const chainId = params.chainId;
  const tokenIn = params.tokenIn;
  const tokenOut = params.tokenOut;
  const amountIn = params.amountIn;

  if (
    typeof chainId !== 'number' ||
    typeof tokenIn !== 'string' ||
    typeof tokenOut !== 'string' ||
    typeof amountIn !== 'string'
  ) {
    // Missing required fields — let the caller try the next layout / throw.
    return null;
  }

  return {
    chainId: chainId,
    tokenIn: tokenIn as Address,
    tokenOut: tokenOut as Address,
    amountIn,
    path: Array.isArray(params.path) ? (params.path as readonly Address[]) : undefined,
    slippageBps: typeof params.slippageBps === 'number' ? params.slippageBps : undefined,
    recipient: typeof params.recipient === 'string' ? (params.recipient as Address) : undefined,
    deadlineSeconds: typeof params.deadlineSeconds === 'number' ? params.deadlineSeconds : undefined,
  };
  // planId/legIndex/adapterName are accepted for symmetric error context but
  // the null-return path intentionally lets the caller produce the final error.
  void planId;
  void legIndex;
  void adapterName;
}

/**
 * Apply slippage tolerance to expected output amount.
 *
 * Formula: `amountOutMin = expectedOut * (10000 - slippageBps) / 10000`
 * All arithmetic in BigInt to avoid precision loss.
 */
export function applySlippage(expectedOut: string, slippageBps: number): string {
  const expected = BigInt(expectedOut);
  const result = (expected * BigInt(10000 - slippageBps)) / 10000n;
  return result.toString();
}

/**
 * Get slippage tolerance from env or default.
 */
export function getSlippageBps(override?: number): number {
  if (override !== undefined) {
    return override;
  }
  const envValue = process.env.DEX_DEFAULT_SLIPPAGE_BPS;
  return envValue ? Number(envValue) : DEFAULT_SLIPPAGE_BPS;
}

// ───────────────────────────────────────────────────────────────────────
// D4-B-2d: live risk gate (shared across all 5 live DEX adapters)
// ───────────────────────────────────────────────────────────────────────

/**
 * Result of a successful live risk-gate check. Carries the USD notional that
 * the adapter must forward to `recordTradeVolume()` after a successful swap.
 */
export interface LiveRiskGateResult {
  /** USD notional of `amountIn` (price × units) — passed to recordTradeVolume. */
  readonly amountInUsd: number;
}

/**
 * Enforce the live DEX risk gate before wallet selection / broadcast.
 *
 * Steps (D4-B-2d):
 * 1. Resolve `tokenIn` USD price via the price oracle. `null` → throw
 *    (fail-closed: never broadcast a live leg without a capital valuation).
 * 2. Resolve `tokenIn` decimals (cached) and compute `amountInUsd`.
 *    Unresolved decimals → throw (same fail-closed reasoning).
 * 3. Call `DexRiskPolicyService.evaluateTrade({ chainId, amountInUsd, ... })`.
 *    `allowed === false` → throw `VenueSubmitClientError` (leg stays retryable).
 *
 * Returns `{ amountInUsd }` so the caller can `recordTradeVolume()` after
 * `tx.wait()` success. Used by all 5 live adapters; `PaperDexAdapter` does NOT
 * call this (paper/live isolation — see paper-dex.adapter.ts).
 *
 * `adapterName` is used purely for error attribution in thrown messages.
 */
export async function enforceLiveRiskGate(args: {
  readonly dexRiskPolicy: DexRiskPolicyService;
  readonly priceOracle: PriceOracleService;
  readonly adapterName: string;
  readonly chainId: ChainId;
  readonly tokenIn: Address;
  readonly tokenOut: Address;
  readonly amountIn: string;
  readonly slippageBps?: number;
}): Promise<LiveRiskGateResult> {
  const { dexRiskPolicy, priceOracle, adapterName, chainId, tokenIn, tokenOut, amountIn } = args;

  // 1. Price tokenIn → USD. Fail-closed on null.
  const tokenInUsd = await priceOracle.getTokenPriceUsd(chainId, tokenIn);
  if (tokenInUsd === null) {
    throw new VenueSubmitClientError(
      `${adapterName}: cannot price tokenIn ${tokenIn} on chain ${chainId} — live risk check blocked`,
      { category: 'semantic' },
    );
  }

  // 2. Decimals (cached). Fail-closed on null — cannot value without units.
  const tokenInDecimals = await priceOracle.getTokenDecimals(chainId, tokenIn);
  if (tokenInDecimals === null) {
    throw new VenueSubmitClientError(
      `${adapterName}: cannot read decimals for tokenIn ${tokenIn} on chain ${chainId} — live risk check blocked`,
      { category: 'semantic' },
    );
  }

  const amountInUnits = Number(BigInt(amountIn)) / 10 ** tokenInDecimals;
  const amountInUsd = amountInUnits * tokenInUsd;

  // 3. evaluateTrade. Throwing on denial keeps the leg in `created` (retryable).
  const risk = await dexRiskPolicy.evaluateTrade({
    chainId,
    amountInUsd,
    estimatedSlippageBps: getSlippageBps(args.slippageBps),
    estimatedGasCostUsd: 0, // refined post-estimateGas if needed later
    tokenIn,
    tokenOut,
  });
  if (!risk.allowed) {
    throw new VenueSubmitClientError(
      `${adapterName}: DEX risk denied: ${risk.reasons.join('; ')}`,
      { category: 'semantic' },
    );
  }

  return { amountInUsd };
}

/**
 * Record traded volume for daily-limit tracking (D4-B-2d). Non-fatal — the swap
 * is already broadcast; any persistence failure is logged inside the service.
 * Call this from each live adapter right after a successful `tx.wait()`.
 */
export async function recordLiveTradeVolume(
  dexRiskPolicy: DexRiskPolicyService,
  chainId: ChainId,
  amountInUsd: number,
): Promise<void> {
  await dexRiskPolicy.recordTradeVolume(chainId, amountInUsd).catch(() => {
    /* logged inside recordTradeVolume; swap already broadcast */
  });
}

// ───────────────────────────────────────────────────────────────────────
// Adapter
// ───────────────────────────────────────────────────────────────────────

/**
 * Uniswap V2-compatible DEX venue adapter.
 *
 * Implements `VenueAdapter.submitLeg()` by:
 * 1. Extracting `DexSwapParams` from `plan.playbookConfig` (multi-leg `legs[]`
 *    first, then legacy `dexSwaps[]` — D4-B-2c)
 * 2. Ensuring ERC20 approval for the router
 * 3. Calculating `amountOutMin` via on-chain quote + slippage
 * 4. Estimating gas and checking policy
 * 5. Constructing and sending `swapExactTokensForTokens` on-chain
 * 6. Returning tx hash as `externalOrderId`
 *
 * **Step:** DEX-1-1-ADAPTER-UNI2
 */
@Injectable()
export class UniswapV2Adapter implements VenueAdapter {
  private readonly logger = new Logger(UniswapV2Adapter.name);

  /** Cached interface for encoding swap calldata */
  private readonly routerInterface = new Interface(UniswapV2RouterABI);

  // Metrics
  private swapCounter!: Counter<string>;
  private swapLatency!: Histogram<string>;

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
   * Submit a DEX swap leg on-chain via Uniswap V2 `swapExactTokensForTokens`.
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
      const params = extractSwapParams(plan, leg);
      const chainLabel = String(params.chainId);

      this.logger.log(
        `submitLeg: plan=${plan.id} leg=${leg.id} chain=${chainLabel} ` +
        `tokenIn=${params.tokenIn} tokenOut=${params.tokenOut} amountIn=${params.amountIn}`,
      );

      // 2. Resolve provider and router address
      const provider = this.rpcProviderManager.getProvider(params.chainId) as JsonRpcProvider;
      const routerAddress = resolveRouterAddress(params.chainId);

      // 2.5 D4-B-2d: live risk gate — evaluateTrade before wallet selection.
      // Fail-closed: unresolvable price/decimals or denied trade → throw, no broadcast.
      const { amountInUsd } = await enforceLiveRiskGate({
        dexRiskPolicy: this.dexRiskPolicy,
        priceOracle: this.priceOracle,
        adapterName: 'UniswapV2Adapter',
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

      // 5. Build swap path
      const swapPath = params.path ?? [params.tokenIn, params.tokenOut];

      // 6. Calculate amountOutMin via on-chain quote + slippage
      const amountOutMin = await this.calculateAmountOutMin(
        params,
        provider,
        routerAddress,
        swapPath,
      );

      // 7. Estimate gas and check policy
      const recipient = params.recipient ?? selectedWallet.address;
      const deadline = Math.floor(Date.now() / 1000) + (params.deadlineSeconds ?? DEFAULT_DEADLINE_SECONDS);

      const txRequest = this.buildSwapTxRequest(
        routerAddress,
        params.amountIn,
        amountOutMin,
        swapPath,
        recipient,
        deadline,
        selectedWallet.address,
      );

      const gasEstimation = await this.gasEstimator.estimateGas(params.chainId, txRequest);

      if (!gasEstimation.withinPolicy) {
        throw new VenueSubmitClientError(
          `UniswapV2Adapter: gas price exceeds policy for chain ${params.chainId}: ` +
          `${gasEstimation.policyWarning}`,
          { category: 'semantic' },
        );
      }

      // 8. Submit transaction
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

      // 9. Wait for receipt (1 confirmation)
      const receipt: TransactionReceipt | null = await tx.wait(1);

      if (!receipt) {
        throw new VenueSubmitTransientError(
          `UniswapV2Adapter: tx ${tx.hash} returned null receipt (possible RPC issue)`,
        );
      }

      if (receipt.status === 0) {
        this.swapCounter.inc({ chain_id: chainLabel, status: 'reverted' });
        throw new VenueTerminalSubmitError(
          `UniswapV2Adapter: tx ${tx.hash} reverted on-chain (status=0)`,
          'failed',
        );
      }

      // 10. Success
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
        `UniswapV2Adapter: unexpected error during submitLeg: ${message}`,
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
   */
  async ensureApproval(
    params: DexSwapParams,
    selectedWallet: SelectedWallet,
    routerAddress: Address,
  ): Promise<void> {
    const amountIn = BigInt(params.amountIn);

    // Check current allowance
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
        `UniswapV2Adapter: ERC20 approve failed for ${params.tokenIn} → ${routerAddress}: tx=${result.txHash}`,
        { category: 'semantic' },
      );
    }

    this.logger.log(`Approval confirmed: tx=${result.txHash}`);
  }

  /**
   * Calculate amountOutMin: on-chain quote via `getAmountsOut` + slippage.
   *
   * Steps:
   * 1. Call router `getAmountsOut(amountIn, path)` for expected output
   * 2. Apply slippage tolerance: `minOut = expectedOut * (10000 - bps) / 10000`
   */
  async calculateAmountOutMin(
    params: DexSwapParams,
    provider: JsonRpcProvider,
    routerAddress: Address,
    swapPath: readonly string[],
  ): Promise<string> {
    const routerContract = new Contract(
      routerAddress,
      UniswapV2RouterABI,
      provider,
    ) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    // Get on-chain quote
    const amounts: bigint[] = await routerContract.getAmountsOut(
      params.amountIn,
      swapPath,
    );

    const expectedAmountOut = amounts[amounts.length - 1]!;
    const expectedAmountOutStr = expectedAmountOut.toString();

    // Apply slippage tolerance
    const slippageBps = getSlippageBps(params.slippageBps);
    const amountOutMin = applySlippage(expectedAmountOutStr, slippageBps);

    this.logger.debug(
      `amountOutMin: expected=${expectedAmountOutStr} slippageBps=${slippageBps} minOut=${amountOutMin}`,
    );

    return amountOutMin;
  }

  /**
   * Build the transaction request object for `swapExactTokensForTokens`.
   */
  buildSwapTxRequest(
    routerAddress: Address,
    amountIn: string,
    amountOutMin: string,
    path: readonly string[],
    recipient: Address,
    deadline: number,
    from: Address,
  ): {
    to: string;
    data: string;
    value: bigint;
    from: string;
  } {
    const data = this.routerInterface.encodeFunctionData('swapExactTokensForTokens', [
      amountIn,
      amountOutMin,
      path,
      recipient,
      deadline,
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
      name: 'arb_dex_uniswap_v2_swap_total',
      help: 'Total Uniswap V2 swap operations',
      labelNames: ['chain_id', 'status'],
      registers: [registry],
    });

    this.swapLatency = new Histogram({
      name: 'arb_dex_uniswap_v2_swap_latency_seconds',
      help: 'Uniswap V2 swap latency in seconds',
      labelNames: ['chain_id'],
      buckets: [0.5, 1, 2, 5, 10, 30, 60],
      registers: [registry],
    });
  }
}