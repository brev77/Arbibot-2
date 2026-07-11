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

// ───────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────

/**
 * DEX swap parameters extracted from plan/leg metadata.
 *
 * Stored in `plan.playbookConfig.dexSwaps[legIndex]` or provided directly
 * for programmatic use. The adapter reads from this structure and does NOT
 * invent default values for missing fields.
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
 * Layout: `plan.playbookConfig.dexSwaps[leg.legIndex]`
 */
export function extractSwapParams(plan: ExecutionPlanEntity, leg: ExecutionLegEntity): DexSwapParams {
  const config = plan.playbookConfig;
  if (!config || typeof config !== 'object') {
    throw new VenueSubmitClientError(
      `UniswapV2Adapter: plan ${plan.id} missing playbookConfig for DEX swap`,
      { category: 'validation' },
    );
  }

  const dexSwaps = config.dexSwaps;
  if (!Array.isArray(dexSwaps)) {
    throw new VenueSubmitClientError(
      `UniswapV2Adapter: plan ${plan.id} playbookConfig.dexSwaps is not an array`,
      { category: 'validation' },
    );
  }

  const params = dexSwaps[leg.legIndex] as Record<string, unknown> | undefined;
  if (!params || typeof params !== 'object') {
    throw new VenueSubmitClientError(
      `UniswapV2Adapter: no swap params at dexSwaps[${leg.legIndex}] for plan ${plan.id}`,
      { category: 'validation' },
    );
  }

  // Validate required fields
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
    throw new VenueSubmitClientError(
      `UniswapV2Adapter: invalid swap params at dexSwaps[${leg.legIndex}] — ` +
      `required: chainId (number), tokenIn (string), tokenOut (string), amountIn (string)`,
      { category: 'validation' },
    );
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
// Adapter
// ───────────────────────────────────────────────────────────────────────

/**
 * Uniswap V2-compatible DEX venue adapter.
 *
 * Implements `VenueAdapter.submitLeg()` by:
 * 1. Extracting `DexSwapParams` from `plan.playbookConfig.dexSwaps[legIndex]`
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