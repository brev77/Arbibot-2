import { Injectable, Logger } from '@nestjs/common';
import { Contract, Interface, JsonRpcProvider, Provider, TransactionReceipt } from 'ethers';
import { Counter, Histogram } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import {
  Address,
  ChainId,
  UniswapV2RouterABI,
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
// Helpers
// ───────────────────────────────────────────────────────────────────────

/** Default deadline in seconds from now (10 minutes). */
const DEFAULT_DEADLINE_SECONDS = 600;

/**
 * Resolve Biswap V2 router address for a given chainId.
 *
 * Only BNB Chain mainnet (56) is supported — Biswap is not deployed on
 * testnet. Returns zero-address for testnet, which will cause a
 * validation error at swap time.
 */
function resolveBiswapV2RouterAddress(chainId: ChainId): Address {
  if (chainId === (56 as ChainId)) {
    return getBnbAddresses(chainId).biswapV2Router;
  }
  // BNB testnet (97) — Biswap not deployed
  if (chainId === (97 as ChainId)) {
    throw new VenueSubmitClientError(
      'BiswapV2Adapter: Biswap is not deployed on BNB testnet (chainId 97). ' +
      'Use PancakeSwap V2 for BNB testnet testing.',
      { category: 'validation' },
    );
  }
  throw new VenueSubmitClientError(
    `BiswapV2Adapter: unsupported chainId ${chainId}. ` +
    `Biswap V2 is only available on BNB Chain mainnet (56).`,
    { category: 'validation' },
  );
}

// ───────────────────────────────────────────────────────────────────────
// Adapter
// ───────────────────────────────────────────────────────────────────────

/**
 * Biswap V2 DEX venue adapter.
 *
 * Biswap is a Uniswap V2 fork on BNB Chain — same
 * `swapExactTokensForTokens` interface, different router/factory addresses.
 * Reuses shared utilities from `uniswap-v2.adapter`.
 *
 * Only supports BNB Chain mainnet (56). Biswap is not deployed on testnet.
 *
 * **Step:** DEX-1-4-BNB
 */
@Injectable()
export class BiswapV2Adapter implements VenueAdapter {
  private readonly logger = new Logger(BiswapV2Adapter.name);

  /** Cached interface for encoding swap calldata */
  private readonly routerInterface = new Interface(UniswapV2RouterABI);

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

      // 2. Resolve provider and Biswap router address
      const provider = this.rpcProviderManager.getProvider(params.chainId) as JsonRpcProvider;
      const routerAddress = resolveBiswapV2RouterAddress(params.chainId);

      // 2.5 D4-B-2d: live risk gate — evaluateTrade before wallet selection.
      // Fail-closed: unresolvable price/decimals or denied trade → throw, no broadcast.
      const { amountInUsd } = await enforceLiveRiskGate({
        dexRiskPolicy: this.dexRiskPolicy,
        priceOracle: this.priceOracle,
        gasEstimator: this.gasEstimator,
        adapterName: 'BiswapV2Adapter',
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

      // P9-5: post-quote live slippage gate using the REAL on-chain quote.
      await enforcePostQuoteSlippageGate({
        dexRiskPolicy: this.dexRiskPolicy,
        priceOracle: this.priceOracle,
        adapterName: 'BiswapV2Adapter',
        chainId: params.chainId,
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn,
        expectedAmountOut,
      });

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
          `BiswapV2Adapter: gas price exceeds policy for chain ${params.chainId}: ` +
          `${gasEstimation.policyWarning}`,
          { category: 'semantic' },
        );
      }

      // 8. Submit transaction (P9-3: explicit nonce under per-wallet lock)
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
            type: 2,
          }),
      );

      this.logger.log(
        `submitLeg: tx sent hash=${tx.hash} plan=${plan.id} leg=${leg.id} ` +
        `gasLimit=${gasEstimation.gasLimit}`,
      );

      // 9. Wait for receipt (1 confirmation) — outside the nonce lock
      const receipt: TransactionReceipt | null = await waitForConfirmation(tx, params.chainId);

      if (!receipt) {
        throw new VenueSubmitTransientError(
          `BiswapV2Adapter: tx ${tx.hash} not confirmed within timeout (possible RPC issue / congestion) — leg stays submitting, poller will reconcile`,
        );
      }

      if (receipt.status === 0) {
        this.swapCounter.inc({ chain_id: chainLabel, status: 'reverted' });
        throw new VenueTerminalSubmitError(
          `BiswapV2Adapter: tx ${tx.hash} reverted on-chain (status=0)`,
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
        `BiswapV2Adapter: unexpected error during submitLeg: ${message}`,
      );
    } finally {
      timer();
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal (public for testability)
  // ─────────────────────────────────────────────────────────────────────

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
        `Sufficient allowance: ${currentAllowance} >= ${amountIn}`,
      );
      return;
    }

    this.logger.log(
      `Insufficient allowance (${currentAllowance} < ${amountIn}), approving ${params.tokenIn}`,
    );

    const result = await this.tokenApprove.approveToken({
      chainId: params.chainId,
      tokenAddress: params.tokenIn,
      spender: routerAddress,
      amount: amountIn,
      // P9-6: approve from the SAME wallet that will swap — previously
      // approveToken did its own round-robin selectWallet and could land on a
      // different wallet, leaving allowance 0 on the swap wallet.
      wallet: { address: selectedWallet.address, wallet: selectedWallet.wallet },
    });

    if (result.status === 'failed') {
      throw new VenueSubmitClientError(
        `BiswapV2Adapter: ERC20 approve failed for ${params.tokenIn}: tx=${result.txHash}`,
        { category: 'semantic' },
      );
    }

    this.logger.log(`Approval confirmed: tx=${result.txHash}`);
  }

  async calculateAmountOutMin(
    params: DexSwapParams,
    provider: JsonRpcProvider,
    routerAddress: Address,
    swapPath: readonly string[],
  ): Promise<{ amountOutMin: string; expectedAmountOut: string }> {
    const routerContract = new Contract(
      routerAddress,
      UniswapV2RouterABI,
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
      name: 'arb_dex_biswap_v2_swap_total',
      help: 'Total Biswap V2 swap operations',
      labelNames: ['chain_id', 'status'],
      registers: [registry],
    });

    this.swapLatency = new Histogram({
      name: 'arb_dex_biswap_v2_swap_latency_seconds',
      help: 'Biswap V2 swap latency in seconds',
      labelNames: ['chain_id'],
      buckets: [0.5, 1, 2, 5, 10, 30, 60],
      registers: [registry],
    });
  }
}