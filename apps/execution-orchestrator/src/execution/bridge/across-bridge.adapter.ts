import { Injectable, Logger } from '@nestjs/common';
import { Contract, Interface, JsonRpcProvider, ZeroAddress } from 'ethers';
import { Counter, Histogram } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import {
  AcrossSpokePoolABI,
  ChainId,
  getAcrossAddresses,
  isAcrossSupportedChainPair,
} from '@arbibot/contracts-eth';

import type {
  BridgeAdapter,
  BridgeFeeEstimate,
  BridgeStatusContext,
  BridgeStatusResult,
  BridgeSubmitResult,
  BridgeTransferParams,
} from './bridge-adapter.interface';
import { BridgeFinalityService } from './bridge-finality.service';

/** Narrow string → Address for ethers.js interop. */
const asAddr = (v: string): `0x${string}` => v as `0x${string}`;
import { RpcProviderManager } from '../rpc/rpc-provider-manager.service';
import { WalletManagerService } from '../wallet-manager.service';
import { GasEstimatorService } from '../gas/gas-estimator.service';
import { TokenApproveService } from '../token/token-approve.service';

// ───────────────────────────────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────────────────────────────

/** Default fill deadline: 30 minutes from deposit. */
const DEFAULT_FILL_DEADLINE_SECONDS = 1800;

/** Default estimated relay time for Across: 2–5 minutes. */
const DEFAULT_ESTIMATED_RELAY_MS = 240_000;

/** Estimated gas for depositV3. */
const ESTIMATED_DEPOSIT_GAS = 200_000n;

/** Estimated gas for destination claim (if needed). */
const ESTIMATED_CLAIM_GAS = 100_000n;

/**
 * Across SpokePool deposit status — mapped from on-chain events.
 */
type _AcrossDepositStatus = 'pending' | 'filled' | 'expired';

// ───────────────────────────────────────────────────────────────────────
// Adapter
// ───────────────────────────────────────────────────────────────────────

/**
 * Across Protocol bridge adapter.
 *
 * Implements `BridgeAdapter` for cross-chain transfers via Across V3 SpokePool.
 * Across uses optimistic verification with bonded relayers for fast (1–5 min) fills.
 *
 * **Step:** DEX-2-1-BRIDGE-ACROSS
 *
 * Supported routes (mainnet + testnet):
 *   - Ethereum ↔ Arbitrum
 *   - Ethereum ↔ Base
 *   - Arbitrum ↔ Base
 */
@Injectable()
export class AcrossBridgeAdapter implements BridgeAdapter {
  readonly bridgeKey = 'across';
  readonly supportedChains: ReadonlyArray<readonly [number, number]>;

  private readonly logger = new Logger(AcrossBridgeAdapter.name);
  private readonly spokePoolInterface = new Interface(AcrossSpokePoolABI);

  // Metrics
  private submitCounter!: Counter<string>;
  private relayLatency!: Histogram<string>;
  private feeHistogram!: Histogram<string>;

  constructor(
    private readonly rpcProviderManager: RpcProviderManager,
    private readonly walletManager: WalletManagerService,
    private readonly gasEstimator: GasEstimatorService,
    private readonly tokenApprove: TokenApproveService,
    private readonly finalityService: BridgeFinalityService,
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
      if (!isAcrossSupportedChainPair(params.sourceChainId, params.destinationChainId)) {
        throw new Error(
          `Across: unsupported chain pair ${params.sourceChainId} → ${params.destinationChainId}`,
        );
      }

      // 2. Resolve provider and SpokePool address
      const provider = this.rpcProviderManager.getProvider(
        params.sourceChainId,
      ) as JsonRpcProvider;
      const spokePoolAddress = getAcrossAddresses(params.sourceChainId).spokePool as string;

      // 3. Select wallet on source chain
      const selectedWallet = await this.walletManager.selectWallet(
        params.sourceChainId,
        provider,
        asAddr(params.token),
        params.amount,
      );

      // 4. Ensure ERC20 approval for SpokePool
      await this.ensureApproval(params, selectedWallet.address, spokePoolAddress);

      // 5. Build depositV3 calldata
      const quoteTimestamp = Math.floor(Date.now() / 1000);
      const fillDeadline = quoteTimestamp + DEFAULT_FILL_DEADLINE_SECONDS;
      const depositor = selectedWallet.address;

      const depositData = this.spokePoolInterface.encodeFunctionData('depositV3', [
        depositor,
        params.recipientAddress as `0x${string}`,
        params.token as `0x${string}`,
        params.destinationToken as `0x${string}`,
        params.amount,
        params.amount, // outputAmount = inputAmount (1:1 for same token bridges)
        BigInt(params.destinationChainId),
        ZeroAddress, // exclusiveRelayer — any relayer can fill
        quoteTimestamp,
        fillDeadline,
        0, // exclusivityDeadline — no exclusivity
        new Uint8Array(0), // empty message
      ]);

      // 6. Estimate gas
      const gasEstimation = await this.gasEstimator.estimateGas(
        params.sourceChainId,
        {
          to: spokePoolAddress,
          data: depositData,
          value: 0n,
          from: depositor,
        },
      );

      if (!gasEstimation.withinPolicy) {
        throw new Error(
          `Across: gas price exceeds policy for chain ${params.sourceChainId}: ` +
          `${gasEstimation.policyWarning}`,
        );
      }

      // 7. Submit depositV3 transaction
      const tx = await selectedWallet.wallet.sendTransaction({
        to: spokePoolAddress,
        data: depositData,
        value: 0n,
        from: depositor,
        gasLimit: gasEstimation.gasLimit,
        maxFeePerGas: gasEstimation.feeData.maxFeePerGas,
        maxPriorityFeePerGas: gasEstimation.feeData.maxPriorityFeePerGas,
        type: 2,
      });

      this.logger.log(
        `submitBridgeTransfer: depositV3 tx sent hash=${tx.hash} ` +
        `${params.sourceChainId} → ${params.destinationChainId}`,
      );

      // 8. Wait for source chain confirmation
      const receipt = await tx.wait(1);
      if (!receipt || receipt.status === 0) {
        this.submitCounter.inc({
          source: String(params.sourceChainId),
          dest: String(params.destinationChainId),
          status: 'reverted',
        });
        throw new Error(
          `Across: depositV3 tx ${tx.hash} reverted on source chain ${params.sourceChainId}`,
        );
      }

      // 9. Extract depositId from events
      const depositId = this.extractDepositId(receipt);

      // 10. Record metrics
      timer({ source: String(params.sourceChainId), dest: String(params.destinationChainId) });
      this.submitCounter.inc({
        source: String(params.sourceChainId),
        dest: String(params.destinationChainId),
        status: 'success',
      });

      this.logger.log(
        `submitBridgeTransfer: confirmed hash=${tx.hash} depositId=${depositId}`,
      );

      return {
        sourceTxHash: tx.hash,
        sourceChainId: params.sourceChainId,
        destinationChainId: params.destinationChainId,
        bridgeId: depositId,
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

  /**
   * Check bridge transfer status with source finality + destination delivery.
   *
   * D4-B-5-BRIDGE (L5):
   * 1. Source-chain finality — wait for chain-specific confirmations (reorg safety).
   * 2. Destination delivery — query the destination SpokePool for `FilledV3Relay`
   *    event filtered by depositId (gives the destination fill tx hash), and
   *    verify `filledDeposits(depositId) > 0`.
   * 3. `completed` only when BOTH source finalized AND destination delivery proven.
   *
   * Fail-closed: on any RPC error, returns the current non-completed status
   * (never `'completed'` or `'failed'` on transient errors).
   */
  async checkBridgeStatus(ctx: BridgeStatusContext): Promise<BridgeStatusResult> {
    const { bridgeId: depositId, sourceChainId, destinationChainId, sourceTxHash } = ctx;

    // 1. Source-chain finality
    const sourceConfirmations = await this.finalityService.getSourceConfirmations(
      sourceTxHash,
      sourceChainId,
    );
    const requiredConfirmations = this.finalityService.getRequiredConfirmationsFor(sourceChainId);

    if (sourceConfirmations < requiredConfirmations) {
      return {
        status: sourceConfirmations > 0 ? 'relaying' : 'pending',
        sourceTxHash,
        destinationTxHash: null,
        confirmations: sourceConfirmations,
        estimatedCompletionMs: DEFAULT_ESTIMATED_RELAY_MS,
      };
    }

    // 2. Destination delivery verification
    try {
      const destProvider = this.rpcProviderManager.getProvider(destinationChainId) as JsonRpcProvider;
      const destSpokePool = getAcrossAddresses(destinationChainId).spokePool as string;
      const spokePool = new Contract(destSpokePool, new Interface(AcrossSpokePoolABI), destProvider);

      // Fast existence check: filledDeposits(depositId) > 0 means a relayer filled it.
      // The ABI declares uint256 return; canonical Across V3 returns the filled amount.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filledAmount = BigInt(await (spokePool as any).filledDeposits(depositId));
      if (filledAmount <= 0n) {
        // Source finalized but relay not filled yet — relaying in progress.
        this.logger.debug(
          `checkBridgeStatus: depositId=${depositId} not filled yet (source finalized, awaiting relayer)`,
        );
        return {
          status: 'relaying',
          sourceTxHash,
          destinationTxHash: null,
          confirmations: sourceConfirmations,
          estimatedCompletionMs: DEFAULT_ESTIMATED_RELAY_MS,
        };
      }

      // Locate the destination fill tx hash via the FilledV3Relay event.
      const destinationTxHash = await this.findFilledRelayTxHash(
        destSpokePool,
        destinationChainId,
        depositId,
      );

      if (!destinationTxHash) {
        // filledDeposits > 0 but the event filter found nothing — treat as confirming
        // (capital-safe: do NOT mark completed without the dest tx hash).
        this.logger.warn(
          `checkBridgeStatus: depositId=${depositId} filledDeposits>0 but no FilledV3Relay event found`,
        );
        return {
          status: 'confirming',
          sourceTxHash,
          destinationTxHash: null,
          confirmations: sourceConfirmations,
          estimatedCompletionMs: DEFAULT_ESTIMATED_RELAY_MS,
        };
      }

      // Destination fill tx confirmed → completed (capital-safe).
      const destConfirmations = await this.finalityService.getSourceConfirmations(
        destinationTxHash,
        destinationChainId,
      );

      this.logger.log(
        `checkBridgeStatus: depositId=${depositId} delivered destTx=${destinationTxHash} ` +
        `(destConfirmations=${destConfirmations})`,
      );

      return {
        status: 'completed',
        sourceTxHash,
        destinationTxHash,
        confirmations: destConfirmations,
        estimatedCompletionMs: 0,
      };
    } catch (error) {
      // Fail-closed: transient RPC error → keep relaying (not completed, not failed).
      this.logger.warn(
        `checkBridgeStatus: destination verification error for depositId=${depositId}: ${String(error)}`,
      );
      return {
        status: 'relaying',
        sourceTxHash,
        destinationTxHash: null,
        confirmations: sourceConfirmations,
        estimatedCompletionMs: DEFAULT_ESTIMATED_RELAY_MS,
      };
    }
  }

  /**
   * Find the destination-chain fill tx hash for an Across depositId by scanning
   * the destination SpokePool's `FilledV3Relay` event (depositId is indexed).
   *
   * Returns null if no matching event is found. Scans a recent window of blocks
   * to bound the RPC cost.
   */
  private async findFilledRelayTxHash(
    destSpokePool: string,
    destinationChainId: number,
    depositId: string,
  ): Promise<string | null> {
    const provider = this.rpcProviderManager.getProvider(destinationChainId) as JsonRpcProvider;
    const iface = new Interface(AcrossSpokePoolABI);
    const contract = new Contract(destSpokePool, iface, provider);

    // FilledV3Relay: depositId is the first indexed param (topics[1]).
    // Build an event filter for the depositId to narrow the query.
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - 10_000);

    try {
      // FilledV3Relay: depositId is indexed (topics[1]); build a filter to narrow.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filterFn = (contract.filters as any).FilledV3Relay as
        | ((depositId?: string) => unknown)
        | undefined;
      const filter = filterFn ? filterFn(depositId) : undefined;
      const logs = filter
        ? await contract.queryFilter(filter as never, fromBlock, currentBlock)
        : await contract.queryFilter('FilledV3Relay', fromBlock, currentBlock);
      for (const log of logs) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parsed = log as any;
        if (parsed.args?.depositId === depositId) {
          return parsed.transactionHash ?? parsed.hash ?? null;
        }
        if (parsed.topics && parsed.topics[1] === depositId) {
          return parsed.transactionHash ?? parsed.hash ?? null;
        }
      }
    } catch (error) {
      this.logger.warn(
        `findFilledRelayTxHash: queryFilter error for depositId=${depositId}: ${String(error)}`,
      );
    }

    return null;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async estimateBridgeFee(_params: BridgeTransferParams): Promise<BridgeFeeEstimate> {
    // TODO: Query Across API for real-time fee estimate
    // Across fee = relayer fee + LP fee + gas
    // For now, return conservative estimates
    const bridgeFee = 0n;
    const relayerFee = 0n;
    const estimatedGasSource = ESTIMATED_DEPOSIT_GAS;
    const estimatedGasDestination = ESTIMATED_CLAIM_GAS;

    this.feeHistogram.observe({ bridge_key: 'across' }, 0);

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
    // Across typical relay: 1–5 minutes for L2↔L2, 5–15 min for L1↔L2
    return DEFAULT_ESTIMATED_RELAY_MS;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal methods
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Ensure the SpokePool has sufficient ERC20 allowance.
   */
  private async ensureApproval(
    params: BridgeTransferParams,
    ownerAddress: string,
    spokePoolAddress: string,
  ): Promise<void> {
    const currentAllowance = await this.tokenApprove.getAllowance({
      chainId: params.sourceChainId,
      tokenAddress: asAddr(params.token),
      owner: asAddr(ownerAddress),
      spender: asAddr(spokePoolAddress),
    });

    if (currentAllowance >= params.amount) {
      this.logger.debug(
        `Sufficient allowance: ${currentAllowance} >= ${params.amount} for ${params.token} → SpokePool`,
      );
      return;
    }

    this.logger.log(
      `Insufficient allowance, approving ${params.token} for SpokePool ${spokePoolAddress}`,
    );

    const result = await this.tokenApprove.approveToken({
      chainId: params.sourceChainId,
      tokenAddress: asAddr(params.token),
      spender: asAddr(spokePoolAddress),
      amount: params.amount,
    });

    if (result.status === 'failed') {
      throw new Error(
        `Across: ERC20 approve failed for ${params.token}: tx=${result.txHash}`,
      );
    }
  }

  /**
   * Extract depositId from V3FundsDeposited event in receipt logs.
   */
  private extractDepositId(receipt: { logs: readonly { topics: readonly string[] }[] }): string {
    const depositTopic = this.spokePoolInterface.getEvent('V3FundsDeposited')!.topicHash;

    for (const log of receipt.logs) {
      if (log.topics[0] === depositTopic) {
        // depositId is the first indexed parameter (topics[1])
        return log.topics[1] ?? 'unknown';
      }
    }

    this.logger.warn('V3FundsDeposited event not found in receipt, using tx hash as bridgeId');
    return 'unknown';
  }

  /**
   * Build supported chain pairs from Across address registry.
   */
  private buildSupportedChains(): ReadonlyArray<readonly [number, number]> {
    const chainIds = [
      ChainId.ETHEREUM_MAINNET,
      ChainId.ARBITRUM_ONE_MAINNET,
      ChainId.BASE_MAINNET,
      ChainId.ETHEREUM_TESTNET_SEPOLIA,
      ChainId.ARBITRUM_ONE_SEPOLIA,
      ChainId.BASE_SEPOLIA,
    ];

    const pairs: [number, number][] = [];
    for (const src of chainIds) {
      for (const dst of chainIds) {
        if (src !== dst && isAcrossSupportedChainPair(src, dst)) {
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
      name: 'arb_bridge_across_submit_total',
      help: 'Total Across bridge transfer submissions',
      labelNames: ['source', 'dest', 'status'],
      registers: [registry],
    });

    this.relayLatency = new Histogram({
      name: 'arb_bridge_across_relay_duration_seconds',
      help: 'Across bridge relay duration in seconds',
      labelNames: ['source', 'dest'],
      buckets: [30, 60, 120, 300, 600, 1800],
      registers: [registry],
    });

    this.feeHistogram = new Histogram({
      name: 'arb_bridge_across_fee_usd',
      help: 'Across bridge fee in USD',
      labelNames: ['bridge_key'],
      buckets: [0.1, 0.5, 1, 5, 10, 50],
      registers: [registry],
    });
  }
}