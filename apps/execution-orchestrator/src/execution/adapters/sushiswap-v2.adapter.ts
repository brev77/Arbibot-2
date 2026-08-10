import { Injectable, Logger } from '@nestjs/common';
import { Contract, Interface, JsonRpcProvider, Provider, TransactionReceipt } from 'ethers';
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
import { NonceManagerService } from '../nonce-manager.service';
import { waitForConfirmation } from '../tx-confirmation.service';
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
  enforcePostQuoteSlippageGate,
} from './uniswap-v2.adapter';
import { ensureWrappedNativeBalance } from './native-wrap';

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
 * Timeout for the ERC20 approve step (allowance read + approve broadcast + receipt
 * wait) inside {@link SushiSwapV2Adapter.ensureApproval}. Approve runs OUTSIDE the
 * swap's `withBroadcastLock`, so a hung approve previously left the leg in
 * `submitting` with no bound. On timeout the approve call is abandoned; the leg
 * fails fast instead of hanging.
 */
const APPROVE_TX_TIMEOUT_MS = process.env.APPROVE_TX_TIMEOUT_MS
  ? Number.parseInt(process.env.APPROVE_TX_TIMEOUT_MS, 10)
  : 60_000;

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
    private readonly nonceManager: NonceManagerService,
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

    // Instrumentation: track each step's duration so a hung broadcast path
    // points at the exact stage (risk gate / wallet / approval / quote /
    // broadcast / receipt) instead of a generic "leg stuck in submitting".
    const stepStart = Date.now();
    const step = (name: string, extra: string = ''): void => {
      this.logger.log(
        `submitLeg step=${name} plan=${plan.id} leg=${leg.id} took=${Date.now() - stepStart}ms${extra.length > 0 ? ` ${extra}` : ''}`,
      );
    };

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
        gasEstimator: this.gasEstimator,
        adapterName: 'SushiSwapAdapter',
        chainId: params.chainId,
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn,
        slippageBps: params.slippageBps,
      });
      step('risk_gate_passed', `amountInUsd=${amountInUsd}`);

      // 3. Select wallet
      const selectedWallet = await this.walletManager.selectWallet(
        params.chainId,
        provider,
        params.tokenIn,
        BigInt(params.amountIn),
      );
      step('wallet_selected', `address=${selectedWallet.address}`);

      // 4. Build swap path
      const swapPath = params.path ?? [params.tokenIn, params.tokenOut];

      // 5. Calculate amountOutMin via on-chain quote + slippage (PLAN13 #50: quote BEFORE
      // approve — getAmountsOut is a read-only view call, no allowance needed. This lets the
      // slippage gate reject a bad swap before we spend gas on an ERC20 approve tx.)
      const { amountOutMin, expectedAmountOut } = await this.calculateAmountOutMin(
        params,
        provider,
        routerAddress,
        swapPath,
      );
      step('amount_out_min', `amountOutMin=${amountOutMin} expectedAmountOut=${expectedAmountOut}`);

      // P9-5: post-quote live slippage gate using the REAL on-chain quote.
      await enforcePostQuoteSlippageGate({
        dexRiskPolicy: this.dexRiskPolicy,
        priceOracle: this.priceOracle,
        adapterName: 'SushiSwapV2Adapter',
        chainId: params.chainId,
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn,
        expectedAmountOut,
      });
      step('slippage_gate_passed');

      // 6. Ensure ERC20 approval for the router (PLAN13 #50: moved after slippage gate so
      // a gate-blocked swap does not spend gas on an approve tx).
      // PLAN13 #51: if tokenIn is the wrapped native (WETH/WBNB) and the wallet holds only
      // naked ETH, wrap the shortfall so the router's transferFrom succeeds.
      await ensureWrappedNativeBalance({
        chainId: params.chainId,
        tokenIn: params.tokenIn,
        amountIn: params.amountIn,
        wallet: selectedWallet,
      });
      await this.ensureApproval(params, selectedWallet, routerAddress);
      step('approval_confirmed');

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
      step('gas_estimated', `gasLimit=${gasEstimation.gasLimit}`);

      // 8. Submit transaction (P9-3: explicit nonce under per-wallet lock)
      this.logger.log(
        `submitLeg step=broadcast_acquiring_lock plan=${plan.id} leg=${leg.id} ` +
        `address=${selectedWallet.address} took=${Date.now() - stepStart}ms`,
      );
      const tx = await this.nonceManager.withBroadcastLock(
        params.chainId,
        selectedWallet.address,
        selectedWallet.wallet.provider as Provider,
        (nonce) =>
          selectedWallet.wallet.sendTransaction({
            ...txRequest,
            nonce,
            gasLimit: gasEstimation.gasLimit,
            maxFeePerGas: gasEstimation.feeData.maxFeePerGas,
            maxPriorityFeePerGas: gasEstimation.feeData.maxPriorityFeePerGas,
            type: 2, // EIP-1559
          }),
      );

      this.logger.log(
        `submitLeg step=broadcast_tx_sent plan=${plan.id} leg=${leg.id} ` +
        `hash=${tx.hash} took=${Date.now() - stepStart}ms ` +
        `gasLimit=${gasEstimation.gasLimit} estimatedCost=${gasEstimation.estimatedCostEth} ETH`,
      );

      // 9. Wait for receipt (1 confirmation) — outside the nonce lock
      const receipt: TransactionReceipt | null = await waitForConfirmation(tx, params.chainId);

      if (!receipt) {
        throw new VenueSubmitTransientError(
          `SushiSwapAdapter: tx ${tx.hash} not confirmed within timeout (possible RPC issue / congestion) — leg stays submitting, poller will reconcile`,
        );
      }

      if (receipt.status === 0) {
        this.swapCounter.inc({ chain_id: chainLabel, status: 'reverted' });
        throw new VenueTerminalSubmitError(
          `SushiSwapAdapter: tx ${tx.hash} reverted on-chain (status=0)`,
          'failed',
        );
      }
      step('receipt_confirmed', `status=${receipt.status} hash=${tx.hash}`);

      // 10. Success
      timer({ chain_id: chainLabel });
      this.swapCounter.inc({ chain_id: chainLabel, status: 'success' });

      this.logger.log(
        `submitLeg: confirmed hash=${tx.hash} gasUsed=${receipt.gasUsed.toString()} ` +
        `block=${receipt.blockNumber}`,
      );

      // D4-B-2d: record traded volume for daily-limit tracking (non-fatal).
      await recordLiveTradeVolume(this.dexRiskPolicy, params.chainId, amountInUsd);

      // P9-2: return on-chain proof so the orchestrator persists an
      // OnChainTransaction row (single-writer = OnChainTransactionService).
      return {
        externalOrderId: tx.hash,
        onChain: {
          txHash: tx.hash,
          chainId: params.chainId,
          fromAddress: selectedWallet.address,
          toAddress: routerAddress,
          nonce: tx.nonce,
          gasLimit: gasEstimation.gasLimit.toString(),
          gasUsed: receipt.gasUsed.toString(),
          gasPrice: (receipt.gasPrice ?? null)?.toString() ?? null,
          maxFeePerGas: gasEstimation.feeData.maxFeePerGas.toString(),
          maxPriorityFeePerGas: gasEstimation.feeData.maxPriorityFeePerGas.toString(),
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash ?? null,
          transactionIndex: receipt.index ?? null,
          value: '0',
          status: 'confirmed' as const,
        },
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
    const approveStart = Date.now();

    this.logger.log(
      `ensureApproval: reading allowance token=${params.tokenIn} ` +
      `owner=${selectedWallet.address} spender=${routerAddress}`,
    );
    const currentAllowance = await this.tokenApprove.getAllowance({
      chainId: params.chainId,
      tokenAddress: params.tokenIn,
      owner: selectedWallet.address,
      spender: routerAddress,
    });
    this.logger.log(
      `ensureApproval: allowance read current=${currentAllowance} required=${amountIn} ` +
      `took=${Date.now() - approveStart}ms`,
    );

    if (currentAllowance >= amountIn) {
      this.logger.debug(
        `Sufficient allowance: ${currentAllowance} >= ${amountIn} for ${params.tokenIn} → ${routerAddress}`,
      );
      return;
    }

    this.logger.log(
      `Insufficient allowance (${currentAllowance} < ${amountIn}), approving ${params.tokenIn} for ${routerAddress}`,
    );
    this.logger.log(
      `ensureApproval: sending approve tx token=${params.tokenIn} spender=${routerAddress} ` +
      `amount=${amountIn} wallet=${selectedWallet.address}`,
    );

    // Bound the approve call (allowance read happens above; this bounds the
    // broadcast + receipt wait). Approve runs OUTSIDE the swap's broadcast
    // lock, so without this bound a hung RPC inside approveToken would leave
    // the leg in `submitting` forever.
    let approveTimer: ReturnType<typeof setTimeout> | undefined;
    const approveTimeout = new Promise<never>((_, reject) => {
      approveTimer = setTimeout(
        () => reject(new Error('ERC20 approve tx timeout')),
        APPROVE_TX_TIMEOUT_MS,
      );
    });
    let result;
    try {
      result = await Promise.race([
        this.tokenApprove.approveToken({
          chainId: params.chainId,
          tokenAddress: params.tokenIn,
          spender: routerAddress,
          amount: amountIn,
          // P9-6: approve from the SAME wallet that will swap — previously
          // approveToken did its own round-robin selectWallet and could land on a
          // different wallet, leaving allowance 0 on the swap wallet.
          wallet: { address: selectedWallet.address, wallet: selectedWallet.wallet },
        }),
        approveTimeout,
      ]);
    } finally {
      if (approveTimer !== undefined) {
        clearTimeout(approveTimer);
      }
    }

    this.logger.log(
      `ensureApproval: approve tx result status=${result.status} tx=${result.txHash} ` +
      `took=${Date.now() - approveStart}ms`,
    );

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
  ): Promise<{ amountOutMin: string; expectedAmountOut: string }> {
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

    return { amountOutMin, expectedAmountOut: expectedAmountOutStr };
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