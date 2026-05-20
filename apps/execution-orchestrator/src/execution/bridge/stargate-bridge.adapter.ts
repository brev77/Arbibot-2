import { Injectable, Logger } from '@nestjs/common';
import { Contract, Interface, JsonRpcProvider, ZeroAddress } from 'ethers';
import { Counter, Histogram } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import {
  StargateRouterV2ABI,
  ChainId,
  getStargateAddresses,
  isStargateSupportedChainPair,
} from '@arbibot/contracts-eth';

import type {
  BridgeAdapter,
  BridgeFeeEstimate,
  BridgeStatusResult,
  BridgeSubmitResult,
  BridgeTransferParams,
} from './bridge-adapter.interface';

/** Narrow string → Address for ethers.js interop. */
const asAddr = (v: string): `0x${string}` => v as `0x${string}`;
import { RpcProviderManager } from '../rpc/rpc-provider-manager.service';
import { WalletManagerService } from '../wallet-manager.service';
import { GasEstimatorService } from '../gas/gas-estimator.service';
import { TokenApproveService } from '../token/token-approve.service';

// ───────────────────────────────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────────────────────────────

/**
 * Default slippage tolerance in basis points (0.5%).
 * Applied as minAmountLD = amount * (10000 - slippageBP) / 10000.
 */
const DEFAULT_SLIPPAGE_BP = 50;

/** Default estimated relay time for Stargate V2 via LayerZero: 5–20 minutes. */
const DEFAULT_ESTIMATED_RELAY_MS = 600_000;

/** Estimated gas for Stargate swap (higher due to LayerZero messaging). */
const ESTIMATED_SWAP_GAS = 350_000n;

/** Estimated gas for destination claim (usually not needed with Stargate). */
const ESTIMATED_CLAIM_GAS = 50_000n;

// ───────────────────────────────────────────────────────────────────────
// Adapter
// ───────────────────────────────────────────────────────────────────────

/**
 * Stargate V2 bridge adapter.
 *
 * Implements `BridgeAdapter` for cross-chain transfers via Stargate V2 Router.
 * Stargate uses LayerZero V2 for cross-chain messaging with pooled liquidity
 * and bus-based dispatch for batched transfers.
 *
 * **Step:** DEX-2-1-BRIDGE-STG
 *
 * Supported routes (mainnet + testnet):
 *   - Ethereum ↔ Arbitrum
 *   - Ethereum ↔ Base
 *   - Ethereum ↔ BNB Chain
 *   - Arbitrum ↔ Base
 *   - Arbitrum ↔ BNB Chain
 *   - Base ↔ BNB Chain
 */
@Injectable()
export class StargateBridgeAdapter implements BridgeAdapter {
  readonly bridgeKey = 'stargate';
  readonly supportedChains: ReadonlyArray<readonly [number, number]>;

  private readonly logger = new Logger(StargateBridgeAdapter.name);
  private readonly routerInterface = new Interface(StargateRouterV2ABI);

  // Metrics
  private submitCounter!: Counter<string>;
  private relayLatency!: Histogram<string>;
  private feeHistogram!: Histogram<string>;

  constructor(
    private readonly rpcProviderManager: RpcProviderManager,
    private readonly walletManager: WalletManagerService,
    private readonly gasEstimator: GasEstimatorService,
    private readonly tokenApprove: TokenApproveService,
  ) {
    this.supportedChains = this.buildSupportedChains();
    this.initializeMetrics();
  }

  // ─────────────────────────────────────────────────────────────────────
  // BridgeAdapter implementation
  // ─────────────────────────────────────────────────────────────────────

  async submitBridgeTransfer(params: BridgeTransferParams): Promise<BridgeSubmitResult> {
    const timer = this.relayLatency.startTimer({
      source: String(params.sourceChainId),
      dest: String(params.destinationChainId),
    });

    try {
      this.logger.log(
        `submitBridgeTransfer: ${params.sourceChainId} → ${params.destinationChainId} ` +
        `token=${params.token} amount=${params.amount}`,
      );

      // 1. Validate chain pair
      if (!isStargateSupportedChainPair(params.sourceChainId, params.destinationChainId)) {
        throw new Error(
          `Stargate: unsupported chain pair ${params.sourceChainId} → ${params.destinationChainId}`,
        );
      }

      // 2. Resolve provider and Router address
      const provider = this.rpcProviderManager.getProvider(
        params.sourceChainId as ChainId,
      ) as JsonRpcProvider;
      const routerAddress = getStargateAddresses(params.sourceChainId).router as string;

      // 3. Select wallet on source chain
      const selectedWallet = await this.walletManager.selectWallet(
        params.sourceChainId as ChainId,
        provider,
        asAddr(params.token),
        params.amount,
      );

      // 4. Ensure ERC20 approval for Router
      await this.ensureApproval(params, selectedWallet.address, routerAddress);

      // 5. Quote LayerZero fee for cross-chain relay
      const lzFee = await this.quoteLayerZeroFee(params, provider, routerAddress);
      this.logger.log(`Quoted LayerZero fee: ${lzFee} wei`);

      // 6. Build swap calldata with slippage protection
      const minAmountLD = (params.amount * BigInt(10000 - DEFAULT_SLIPPAGE_BP)) / 10000n;
      const recipient = params.recipientAddress || selectedWallet.address;

      const swapData = this.routerInterface.encodeFunctionData('swap', [
        params.token as `0x${string}`,
        params.amount,
        minAmountLD,
        recipient as `0x${string}`,
      ]);

      // 7. Estimate gas (include LZ fee as value)
      const gasEstimation = await this.gasEstimator.estimateGas(
        params.sourceChainId as ChainId,
        {
          to: routerAddress,
          data: swapData,
          value: lzFee,
          from: selectedWallet.address,
        },
      );

      if (!gasEstimation.withinPolicy) {
        throw new Error(
          `Stargate: gas price exceeds policy for chain ${params.sourceChainId}: ` +
          `${gasEstimation.policyWarning}`,
        );
      }

      // 8. Submit swap transaction
      const tx = await selectedWallet.wallet.sendTransaction({
        to: routerAddress,
        data: swapData,
        value: lzFee,
        from: selectedWallet.address,
        gasLimit: gasEstimation.gasLimit,
        maxFeePerGas: gasEstimation.feeData.maxFeePerGas,
        maxPriorityFeePerGas: gasEstimation.feeData.maxPriorityFeePerGas,
        type: 2,
      });

      this.logger.log(
        `submitBridgeTransfer: swap tx sent hash=${tx.hash} ` +
        `${params.sourceChainId} → ${params.destinationChainId}`,
      );

      // 9. Wait for source chain confirmation
      const receipt = await tx.wait(1);
      if (!receipt || receipt.status === 0) {
        this.submitCounter.inc({
          source: String(params.sourceChainId),
          dest: String(params.destinationChainId),
          status: 'reverted',
        });
        throw new Error(
          `Stargate: swap tx ${tx.hash} reverted on source chain ${params.sourceChainId}`,
        );
      }

      // 10. Extract swap ID from events
      const swapId = this.extractSwapId(receipt, tx.hash);

      // 11. Record metrics
      timer({ source: String(params.sourceChainId), dest: String(params.destinationChainId) });
      this.submitCounter.inc({
        source: String(params.sourceChainId),
        dest: String(params.destinationChainId),
        status: 'success',
      });

      this.logger.log(
        `submitBridgeTransfer: confirmed hash=${tx.hash} swapId=${swapId}`,
      );

      return {
        sourceTxHash: tx.hash,
        sourceChainId: params.sourceChainId,
        destinationChainId: params.destinationChainId,
        bridgeId: swapId,
        estimatedRelayMs: DEFAULT_ESTIMATED_RELAY_MS,
      };
    } catch (error) {
      this.submitCounter.inc({
        source: String(params.sourceChainId),
        dest: String(params.destinationChainId),
        status: 'error',
      });
      throw error;
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async checkBridgeStatus(bridgeId: string): Promise<BridgeStatusResult> {
    // TODO: Implement on-chain status polling via Stargate/LayerZero message status
    // For now, return pending status — full implementation in DEX-2 integration testing
    this.logger.debug(`checkBridgeStatus: swapId=${bridgeId} → pending (stub)`);
    return {
      status: 'pending',
      sourceTxHash: '',
      destinationTxHash: null,
      confirmations: 0,
      estimatedCompletionMs: DEFAULT_ESTIMATED_RELAY_MS,
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async estimateBridgeFee(_params: BridgeTransferParams): Promise<BridgeFeeEstimate> {
    // TODO: Query Stargate API for real-time fee estimate
    // Stargate fee = protocol fee + LayerZero relay fee + gas
    // For now, return conservative estimates
    const bridgeFee = 0n;
    const relayerFee = 0n;
    const estimatedGasSource = ESTIMATED_SWAP_GAS;
    const estimatedGasDestination = ESTIMATED_CLAIM_GAS;

    this.feeHistogram.observe({ bridge_key: 'stargate' }, 0);

    return {
      bridgeFee,
      relayerFee,
      estimatedGasSource,
      estimatedGasDestination,
      totalEstimatedCostUsd: 0,
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async estimateRelayTime(_params: BridgeTransferParams): Promise<number> {
    // Stargate V2 via LayerZero: typically 5–20 min depending on destination chain
    // L2↔L2 is faster (~5 min), L1↔L2 is slower (~10-20 min)
    return DEFAULT_ESTIMATED_RELAY_MS;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal methods
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Ensure the Stargate Router has sufficient ERC20 allowance.
   */
  private async ensureApproval(
    params: BridgeTransferParams,
    ownerAddress: string,
    routerAddress: string,
  ): Promise<void> {
    const currentAllowance = await this.tokenApprove.getAllowance({
      chainId: params.sourceChainId as ChainId,
      tokenAddress: asAddr(params.token),
      owner: asAddr(ownerAddress),
      spender: asAddr(routerAddress),
    });

    if (currentAllowance >= params.amount) {
      this.logger.debug(
        `Sufficient allowance: ${currentAllowance} >= ${params.amount} for ${params.token} → Router`,
      );
      return;
    }

    this.logger.log(
      `Insufficient allowance, approving ${params.token} for Stargate Router ${routerAddress}`,
    );

    const result = await this.tokenApprove.approveToken({
      chainId: params.sourceChainId as ChainId,
      tokenAddress: asAddr(params.token),
      spender: asAddr(routerAddress),
      amount: params.amount,
    });

    if (result.status === 'failed') {
      throw new Error(
        `Stargate: ERC20 approve failed for ${params.token}: tx=${result.txHash}`,
      );
    }
  }

  /**
   * Quote LayerZero fee for a cross-chain swap.
   *
   * Returns the fee in wei that must be sent as `value` in the swap TX.
   * Falls back to 0 if quote fails (will fail at gas estimation instead).
   */
  private async quoteLayerZeroFee(
    params: BridgeTransferParams,
    provider: JsonRpcProvider,
    routerAddress: string,
  ): Promise<bigint> {
    try {
      const routerContract = new Contract(
        routerAddress,
        new Interface(StargateRouterV2ABI),
        provider,
      );

      // Stargate uses uint16 for LayerZero chain IDs (same as EVM chain IDs for our supported chains)
      const dstChainId = params.destinationChainId;
      const recipient = params.recipientAddress || ZeroAddress;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fee = await (routerContract as any).quoteLayerZeroFee(
        dstChainId,
        params.token,
        params.amount,
        recipient,
      );

      return BigInt(fee);
    } catch (error) {
      this.logger.warn(
        `Failed to quote LayerZero fee, using fallback 0: ${String(error)}`,
      );
      return 0n;
    }
  }

  /**
   * Extract swap ID from Swap event in receipt logs.
   */
  private extractSwapId(receipt: { logs: readonly { topics: readonly string[] }[] }, txHash: string): string {
    const swapTopic = this.routerInterface.getEvent('Swap')!.topicHash;

    for (const log of receipt.logs) {
      if (log.topics[0] === swapTopic) {
        // Return tx hash + log index as unique bridgeId
        const logIndex = log.topics[1] ?? '0';
        return `${txHash}:${logIndex}`;
      }
    }

    this.logger.warn('Swap event not found in receipt, using tx hash as bridgeId');
    return txHash;
  }

  /**
   * Build supported chain pairs from Stargate address registry.
   */
  private buildSupportedChains(): ReadonlyArray<readonly [number, number]> {
    const chainIds = [
      ChainId.ETHEREUM_MAINNET,
      ChainId.ARBITRUM_ONE_MAINNET,
      ChainId.BASE_MAINNET,
      ChainId.BNB_CHAIN_MAINNET,
      ChainId.ETHEREUM_TESTNET_SEPOLIA,
      ChainId.ARBITRUM_ONE_SEPOLIA,
      ChainId.BASE_SEPOLIA,
      ChainId.BNB_CHAIN_TESTNET,
    ];

    const pairs: [number, number][] = [];
    for (const src of chainIds) {
      for (const dst of chainIds) {
        if (src !== dst && isStargateSupportedChainPair(src, dst)) {
          pairs.push([src, dst]);
        }
      }
    }
    return pairs;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Metrics
  // ─────────────────────────────────────────────────────────────────────

  private initializeMetrics(): void {
    const registry = getArbibotMetricsRegistry();

    this.submitCounter = new Counter({
      name: 'arb_bridge_stargate_submit_total',
      help: 'Total Stargate bridge transfer submissions',
      labelNames: ['source', 'dest', 'status'],
      registers: [registry],
    });

    this.relayLatency = new Histogram({
      name: 'arb_bridge_stargate_relay_duration_seconds',
      help: 'Stargate bridge relay duration in seconds',
      labelNames: ['source', 'dest'],
      buckets: [60, 120, 300, 600, 1200, 1800],
      registers: [registry],
    });

    this.feeHistogram = new Histogram({
      name: 'arb_bridge_stargate_fee_usd',
      help: 'Stargate bridge fee in USD',
      labelNames: ['bridge_key'],
      buckets: [0.1, 0.5, 1, 5, 10, 50],
      registers: [registry],
    });
  }
}