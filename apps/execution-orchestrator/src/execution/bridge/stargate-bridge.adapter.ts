import { Injectable, Logger } from '@nestjs/common';
import { Contract, Interface, JsonRpcProvider, ZeroAddress, id, keccak256, concat } from 'ethers';
import { Counter, Histogram } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import {
  StargateRouterV2ABI,
  ChainId,
  getStargateAddresses,
  isStargateSupportedChainPair,
  LayerZeroEndpointV2ABI,
  LZ_V2_HEADER,
  getLayerZeroEndpoint,
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
      if (!isStargateSupportedChainPair(params.sourceChainId, params.destinationChainId)) {
        throw new Error(
          `Stargate: unsupported chain pair ${params.sourceChainId} → ${params.destinationChainId}`,
        );
      }

      // 2. Resolve provider and Router address
      const provider = this.rpcProviderManager.getProvider(
        params.sourceChainId,
      ) as JsonRpcProvider;
      const routerAddress = getStargateAddresses(params.sourceChainId).router as string;

      // 3. Select wallet on source chain
      const selectedWallet = await this.walletManager.selectWallet(
        params.sourceChainId,
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
        params.sourceChainId,
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

  /**
   * Check bridge transfer status with source finality + LayerZero V2 delivery.
   *
   * D4-B-5-BRIDGE (L5):
   * 1. Source-chain finality — wait for chain-specific confirmations (reorg safety).
   * 2. LayerZero V2 delivery — parse the `PacketSent` event from the source
   *    Endpoint receipt to recover the guid, then call `delivered(guid)` on the
   *    destination Endpoint. When delivered, locate the destination tx via the
   *    `PacketReceived` event.
   * 3. `completed` only when BOTH source finalized AND delivery proven on-chain.
   *
   * Fail-closed: if the guid cannot be recovered (e.g. PacketSent parsing fails),
   * the transfer holds in `'confirming'` — NEVER auto-completes. Operator must
   * manually complete per runbook B1. On transient RPC errors returns the current
   * non-completed status.
   */
  async checkBridgeStatus(ctx: BridgeStatusContext): Promise<BridgeStatusResult> {
    const { sourceChainId, destinationChainId, sourceTxHash } = ctx;

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

    // 2. Recover the LayerZero guid from the source Endpoint's PacketSent event.
    const guid = await this.recoverLayerZeroGuid(sourceTxHash, sourceChainId);

    if (!guid) {
      // Cannot recover guid → cannot verify delivery. Capital-safe: hold confirming.
      this.logger.warn(
        `checkBridgeStatus: could not recover LayerZero guid from sourceTx=${sourceTxHash}; ` +
        `holding 'confirming' (operator manual completion per runbook B1)`,
      );
      return {
        status: 'confirming',
        sourceTxHash,
        destinationTxHash: null,
        confirmations: sourceConfirmations,
        estimatedCompletionMs: DEFAULT_ESTIMATED_RELAY_MS,
      };
    }

    // 3. Query the destination Endpoint's `delivered(guid)`.
    try {
      const destProvider = this.rpcProviderManager.getProvider(destinationChainId) as JsonRpcProvider;
      const destEndpointAddr = getLayerZeroEndpoint(destinationChainId);
      const destEndpoint = new Contract(
        destEndpointAddr,
        new Interface(LayerZeroEndpointV2ABI),
        destProvider,
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isDelivered = (await (destEndpoint as any).delivered(guid)) as boolean;

      if (!isDelivered) {
        // Source finalized, message in flight — relaying.
        this.logger.debug(
          `checkBridgeStatus: guid=${guid} not yet delivered on destination ${destinationChainId}`,
        );
        return {
          status: 'relaying',
          sourceTxHash,
          destinationTxHash: null,
          confirmations: sourceConfirmations,
          estimatedCompletionMs: DEFAULT_ESTIMATED_RELAY_MS,
        };
      }

      // Delivered — locate the destination tx via the PacketReceived event.
      const destinationTxHash = await this.findPacketReceivedTxHash(
        destEndpointAddr,
        destinationChainId,
        guid,
      );

      const destConfirmations = destinationTxHash
        ? await this.finalityService.getSourceConfirmations(destinationTxHash, destinationChainId)
        : 0;

      this.logger.log(
        `checkBridgeStatus: guid=${guid} delivered destTx=${destinationTxHash ?? 'unknown'}`,
      );

      return {
        status: 'completed',
        sourceTxHash,
        destinationTxHash,
        confirmations: destConfirmations,
        estimatedCompletionMs: 0,
      };
    } catch (error) {
      // Fail-closed: transient RPC error → keep relaying.
      this.logger.warn(
        `checkBridgeStatus: LayerZero delivery verification error for guid=${guid}: ${String(error)}`,
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
   * Recover the LayerZero V2 guid from the source Endpoint's `PacketSent` event.
   *
   * The guid is `keccak256(abi.encodePacked(dstEid, senderPadded32, nonce))`, where
   * the fields are extracted from the packet header embedded in the PacketSent
   * payload. Returns null if the event or header cannot be parsed (capital-safe).
   */
  private async recoverLayerZeroGuid(
    sourceTxHash: string,
    sourceChainId: number,
  ): Promise<string | null> {
    try {
      const provider = this.rpcProviderManager.getProvider(sourceChainId) as JsonRpcProvider;
      const receipt = await provider.getTransactionReceipt(sourceTxHash);
      if (!receipt) {
        return null;
      }

      const sourceEndpointAddr = getLayerZeroEndpoint(sourceChainId);
      const packetSentTopic = id('PacketSent(bytes,bytes)');

      // Find the PacketSent log emitted by the source Endpoint.
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== sourceEndpointAddr.toLowerCase()) {
          continue;
        }
        if (log.topics[0] !== packetSentTopic) {
          continue;
        }

        // Decode the encodedPayload (first arg). The data is abi-encoded:
        //   bytes offset (32) | length (32) | payload...
        const data = log.data;
        // Skip the 32-byte offset, read the 32-byte length, then the payload bytes.
        const payload = this.extractPayload(data);
        if (!payload) {
          continue;
        }

        const guid = this.deriveGuidFromPayload(payload);
        if (guid) {
          return guid;
        }
      }

      return null;
    } catch (error) {
      this.logger.warn(
        `recoverLayerZeroGuid: error for sourceTx=${sourceTxHash}: ${String(error)}`,
      );
      return null;
    }
  }

  /**
   * Extract the PacketSent payload bytes from the abi-encoded log data.
   *
   * PacketSent(bytes encodedPayload, bytes options) — two dynamic bytes args.
   * Layout: [offset1][offset2][len1][payload1...][len2][options...]
   * We read the first dynamic bytes field (encodedPayload).
   */
  private extractPayload(data: string): Uint8Array | null {
    try {
      const bytes = Buffer.from(data.slice(2), 'hex');
      if (bytes.length < 64) {
        return null;
      }
      // First 32 bytes = offset to encodedPayload (relative to start of data).
      // A uint256 occupies 32 bytes; read the low 20 bytes (offset fits in 48 bits).
      const offset1 = bytes.readUIntBE(12, 20);
      const lenOffset = offset1;
      if (lenOffset + 32 > bytes.length) {
        return null;
      }
      const payloadLen = bytes.readUIntBE(lenOffset + 12, 20);
      const payloadStart = lenOffset + 32;
      if (payloadStart + payloadLen > bytes.length) {
        return null;
      }
      return bytes.subarray(payloadStart, payloadStart + payloadLen);
    } catch {
      return null;
    }
  }

  /**
   * Derive the LayerZero V2 guid from the packet payload header.
   *
   * guid = keccak256(abi.encodePacked(dstEid: uint32, sender: bytes32, nonce: uint64))
   * The payload header starts after a 1-byte version: [version][dstEid][sender][nonce]...
   */
  private deriveGuidFromPayload(payload: Uint8Array): string | null {
    try {
      const dstEidEnd = LZ_V2_HEADER.DST_EID_OFFSET + LZ_V2_HEADER.DST_EID_LEN;
      const senderEnd = LZ_V2_HEADER.SENDER_OFFSET + LZ_V2_HEADER.SENDER_LEN;
      const nonceEnd = LZ_V2_HEADER.NONCE_OFFSET + LZ_V2_HEADER.NONCE_LEN;

      if (payload.length < nonceEnd) {
        return null;
      }

      const dstEid = payload.subarray(LZ_V2_HEADER.DST_EID_OFFSET, dstEidEnd);
      const sender = payload.subarray(LZ_V2_HEADER.SENDER_OFFSET, senderEnd);
      const nonce = payload.subarray(LZ_V2_HEADER.NONCE_OFFSET, nonceEnd);

      // guid = keccak256(dstEid || sender || nonce)
      const guidBytes = keccak256(concat([dstEid, sender, nonce]));
      return guidBytes;
    } catch (error) {
      this.logger.debug(`deriveGuidFromPayload: parse error: ${String(error)}`);
      return null;
    }
  }

  /**
   * Find the destination tx hash for a delivered LayerZero message by scanning
   * the destination Endpoint's `PacketReceived` event. The payloadHash is derived
   * from the message, but a pragmatic scan over a recent block window correlates
   * the srcEid/receiver/nonce with the guid. Returns null if not found.
   */
  private async findPacketReceivedTxHash(
    destEndpointAddr: string,
    destinationChainId: number,
    _guid: string,
  ): Promise<string | null> {
    try {
      const provider = this.rpcProviderManager.getProvider(destinationChainId) as JsonRpcProvider;
      const iface = new Interface(LayerZeroEndpointV2ABI);
      const endpoint = new Contract(destEndpointAddr, iface, provider);

      const currentBlock = await provider.getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - 10_000);

      // MsgExecuted(bytes32 indexed guid, ExecutionState state) — guid is topics[1].
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filterFn = (endpoint.filters as any).MsgExecuted;
      const filter = filterFn ? filterFn(_guid) : null;
      const logs = filter
        ? await endpoint.queryFilter(filter, fromBlock, currentBlock)
        : await endpoint.queryFilter('MsgExecuted', fromBlock, currentBlock);

      for (const log of logs) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parsed = log as any;
        if (parsed.args?.guid === _guid || (parsed.topics && parsed.topics[1] === _guid)) {
          return parsed.transactionHash ?? parsed.hash ?? null;
        }
      }
      return null;
    } catch (error) {
      this.logger.warn(
        `findPacketReceivedTxHash: error for guid=${_guid}: ${String(error)}`,
      );
      return null;
    }
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
      chainId: params.sourceChainId,
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
      chainId: params.sourceChainId,
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