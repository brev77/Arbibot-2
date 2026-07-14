import { Injectable, Logger } from '@nestjs/common';
import { Contract, Interface, JsonRpcProvider, TransactionReceipt } from 'ethers';
import { Counter, Histogram } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import {
  Address,
  ChainId,
  SushiSwapRouterABI,
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
  DexSwapParams,
  extractSwapParams,
  enforceLiveRiskGate,
  recordLiveTradeVolume,
} from './uniswap-v2.adapter';

// ───────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────

/**
 * Result of a successful SushiSwap V2 swap submission.
 */
export interface SushiSwapV2SwapResult extends VenueLegSubmitResult {
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

/**
 * Resolve SushiSwap router address for a given chainId.
 *
 * Supports Arbitrum, Base, BNB Chain (mainnet + testnet).
 * Throws if no SushiSwap deployment exists for the chain.
 */
function resolveSushiRouterAddress(chainId: ChainId): Address {
  // Arbitrum
  if (
    chainId === (42161 as ChainId) ||
    chainId === (421611 as ChainId) ||
    chainId === (421614 as ChainId)
  ) {
    return getArbitrumAddresses(chainId).sushiSwapRouter;
  }
  // Base
  if (
    chainId === (8453 as ChainId) ||
    chainId === (84532 as ChainId)
  ) {
    const addr = getBaseAddresses(chainId).sushiSwapRouter;
    if (addr === '0x0000000000000000000000000000000000000000') {
      throw new VenueSubmitClientError(
        `SushiSwapAdapter: no SushiSwap deployment on Base chain ${chainId}`,
        { category: 'validation' },
      );
    }
    return addr;
  }
  // BNB Chain
  if (chainId === (56 as ChainId) || chainId === (97 as ChainId)) {
    const addr = getBnbAddresses(chainId).sushiSwapRouter;
    if (addr === '0x0000000000000000000000000000000000000000') {
      throw new VenueSubmitClientError(
        `SushiSwapAdapter: no SushiSwap deployment on BNB chain ${chainId}`,
        { category: 'validation' },
      );
    }
    return addr;
  }
  throw new VenueSubmitClientError(
    `SushiSwapAdapter: unsupported chainId ${chainId}`,
    { category: 'validation' },
  );
}

// ───────────────────────────────────────────────────────────────────────
// Adapter
// ───────────────────────────────────────────────────────────────────────

/**
 * SushiSwap V2-compatible DEX venue adapter.
 *
 * SushiSwap is a Uniswap V2 fork — same `swapExactTokensForTokens` interface,
 * different router addresses per chain. Reuses shared utilities from
 * `uniswap-v2.adapter` (`applySlippage`, `getSlippageBps`, `DexSwapParams`,
 * `extractSwapParams`).
 *
 * **Step:** DEX-1-1-ADAPTER-SUSHI
 */
@Injectable()
export class SushiSwapV2Adapter implements VenueAdapter {
  private readonly logger = new Logger(SushiSwapV2Adapter.name);

  /** Cached interface for encoding swap calldata */
  private readonly routerInterface = new Interface(SushiSwapRouterABI);

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
   * Submit a DEX swap leg on-chain via SushiSwap V2 `swapExactTokensForTokens`.
   *
   * Returns `{ externalOrderId: txHash }` on success.
   */
  async submitLeg(
    plan: ExecutionPlanEntity,
    leg: ExecutionLegEntity,
  ): Promise<VenueLegSubmitResult> {
    const timer = this.swapLatency.startTimer({ chain_id: 'unknown' });

    try {
      // 1. Extract swap parameters (shared with UniV2)
      const params = extractSwapParams(plan, leg);
      const chainLabel = String(params.chainId);

      this.logger.log(
        `submitLeg: plan=${plan.id} leg=${leg.id} chain=${chainLabel} ` +
        `tokenIn=${params.tokenIn} tokenOut=${params.tokenOut} amountIn=${params.amountIn}`,
      );

      // 2. Resolve provider and SushiSwap router address
      const provider = this.rpcProviderManager.getProvider(params.chainId) as JsonRpcProvider;
      const routerAddress = resolveSushiRouterAddress(params.chainId);

      // 2.5 D4-B-2d: live risk gate — evaluateTrade before wallet selection.
      // Fail-closed: unresolvable price/decimals or denied trade → throw, no broadcast.
      const { amountInUsd } = await enforceLiveRiskGate({
        dexRiskPolicy: this.dexRiskPolicy,
        priceOracle: this.priceOracle,
        adapterName: 'SushiSwapAdapter',
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
          `SushiSwapAdapter: gas price exceeds policy for chain ${params.chainId}: ` +
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
          `SushiSwapAdapter: tx ${tx.hash} returned null receipt (possible RPC issue)`,
        );
      }

      if (receipt.status === 0) {
        this.swapCounter.inc({ chain_id: chainLabel, status: 'reverted' });
        throw new VenueTerminalSubmitError(
          `SushiSwapAdapter: tx ${tx.hash} reverted on-chain (status=0)`,
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

      const message = error instanceof Error ? error.message : String(error);
      this.swapCounter.inc({ chain_id: 'unknown', status: 'error' });
      throw new VenueSubmitTransientError(
        `SushiSwapAdapter: unexpected error during submitLeg: ${message}`,
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
        `SushiSwapAdapter: ERC20 approve failed for ${params.tokenIn} → ${routerAddress}: tx=${result.txHash}`,
        { category: 'semantic' },
      );
    }

    this.logger.log(`Approval confirmed: tx=${result.txHash}`);
  }

  /**
   * Calculate amountOutMin: on-chain quote via `getAmountsOut` + slippage.
   */
  async calculateAmountOutMin(
    params: DexSwapParams,
    provider: JsonRpcProvider,
    routerAddress: Address,
    swapPath: readonly string[],
  ): Promise<string> {
    const routerContract = new Contract(
      routerAddress,
      SushiSwapRouterABI,
      provider,
    ) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    const amounts: bigint[] = await routerContract.getAmountsOut(
      params.amountIn,
      swapPath,
    );

    const expectedAmountOut = amounts[amounts.length - 1]!;
    const expectedAmountOutStr = expectedAmountOut.toString();

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
      name: 'arb_dex_sushiswap_v2_swap_total',
      help: 'Total SushiSwap V2 swap operations',
      labelNames: ['chain_id', 'status'],
      registers: [registry],
    });

    this.swapLatency = new Histogram({
      name: 'arb_dex_sushiswap_v2_swap_latency_seconds',
      help: 'SushiSwap V2 swap latency in seconds',
      labelNames: ['chain_id'],
      buckets: [0.5, 1, 2, 5, 10, 30, 60],
      registers: [registry],
    });
  }
}