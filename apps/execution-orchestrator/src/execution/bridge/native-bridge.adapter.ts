import { Injectable, Logger } from '@nestjs/common';
import { Interface, JsonRpcProvider, ZeroAddress } from 'ethers';
import { Counter, Histogram } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import {
  ArbitrumInboxABI,
  L1StandardBridgeABI,
  L2StandardBridgeABI,
  ChainId,
  getNativeBridgeAddresses,
  isNativeSupportedChainPair,
} from '@arbibot/contracts-eth';

import type {
  BridgeAdapter,
  BridgeFeeEstimate,
  BridgeStatusResult,
  BridgeSubmitResult,
  BridgeTransferParams,
} from './bridge-adapter.interface';

import { WalletManagerService, type SelectedWallet } from '../wallet-manager.service';
import { RpcProviderManager } from '../rpc/rpc-provider-manager.service';
import { GasEstimatorService } from '../gas/gas-estimator.service';
import { TokenApproveService } from '../token/token-approve.service';

/** Narrow string → Address for ethers.js interop. */
const asAddr = (v: string): `0x${string}` => v as `0x${string}`;

// ───────────────────────────────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────────────────────────────

/** L1→L2 deposit relay time: ~10 min (Arbitrum sequencer / Optimism). */
const ESTIMATED_RELAY_MS_L1_TO_L2 = 600_000;

/** L2→L1 withdrawal: ~7 days (challenge period). */
const ESTIMATED_RELAY_MS_L2_TO_L1 = 604_800_000;

/** Estimated gas for L1→L2 deposit (Arbitrum Inbox). */
const ESTIMATED_GAS_ARB_DEPOSIT = 200_000n;

/** Estimated gas for L1→L2 deposit (Optimism Standard Bridge). */
const ESTIMATED_GAS_OP_DEPOSIT = 150_000n;

/** Estimated gas for L2→L1 withdrawal initiation. */
const ESTIMATED_GAS_WITHDRAW = 100_000n;

/** Gas limit for L2 side of the deposit (passed as parameter). */
const L2_GAS_LIMIT_DEPOSIT = 200_000;

/** ERC20 "wrapped ETH" address sentinel — indicates native ETH transfer. */
const NATIVE_ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

// ───────────────────────────────────────────────────────────────────────
// Adapter
// ───────────────────────────────────────────────────────────────────────

/**
 * Native bridge adapter for canonical L2 bridges.
 *
 * Implements `BridgeAdapter` for official/canonical bridges:
 *   - Arbitrum: L1 Inbox (`depositEth`) / L2 Outbox (withdrawal)
 *   - Base (Optimism): L1StandardBridge (`depositETH`, `depositERC20`)
 *                       L2StandardBridge (`withdraw`, `bridgeERC20`)
 *
 * **Step:** DEX-2-1-BRIDGE-NATIVE
 */
@Injectable()
export class NativeBridgeAdapter implements BridgeAdapter {
  readonly bridgeKey = 'native';
  readonly supportedChains: ReadonlyArray<readonly [number, number]>;

  private readonly logger = new Logger(NativeBridgeAdapter.name);

  private readonly arbitrumInboxInterface = new Interface(ArbitrumInboxABI);
  private readonly l1StandardBridgeInterface = new Interface(L1StandardBridgeABI);
  private readonly l2StandardBridgeInterface = new Interface(L2StandardBridgeABI);

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
  // BridgeAdapter
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

      if (!isNativeSupportedChainPair(params.sourceChainId, params.destinationChainId)) {
        throw new Error(
          `Native bridge: unsupported chain pair ${params.sourceChainId} → ${params.destinationChainId}`,
        );
      }

      const bridgeAddresses = getNativeBridgeAddresses(
        params.sourceChainId,
        params.destinationChainId,
      );

      const provider = this.rpcProviderManager.getProvider(
        params.sourceChainId as ChainId,
      ) as JsonRpcProvider;

      const selectedWallet = await this.walletManager.selectWallet(
        params.sourceChainId as ChainId,
        provider,
        asAddr(params.token),
        params.amount,
      );

      const txHash = await this.submitByBridgeType(params, bridgeAddresses, selectedWallet);

      timer({ source: String(params.sourceChainId), dest: String(params.destinationChainId) });
      this.submitCounter.inc({
        source: String(params.sourceChainId),
        dest: String(params.destinationChainId),
        status: 'success',
      });

      const isL1ToL2 = this.isL1Chain(params.sourceChainId);
      const estimatedRelayMs = isL1ToL2
        ? ESTIMATED_RELAY_MS_L1_TO_L2
        : ESTIMATED_RELAY_MS_L2_TO_L1;

      this.logger.log(
        `submitBridgeTransfer: confirmed hash=${txHash} ` +
        `${params.sourceChainId} → ${params.destinationChainId} ` +
        `estimatedRelay=${estimatedRelayMs}ms`,
      );

      return {
        sourceTxHash: txHash,
        sourceChainId: params.sourceChainId,
        destinationChainId: params.destinationChainId,
        bridgeId: `${txHash}:native`,
        estimatedRelayMs,
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
  async checkBridgeStatus(_bridgeId: string): Promise<BridgeStatusResult> {
    this.logger.debug(`checkBridgeStatus: bridgeId=${_bridgeId} → pending (stub)`);
    return {
      status: 'pending',
      sourceTxHash: '',
      destinationTxHash: null,
      confirmations: 0,
      estimatedCompletionMs: ESTIMATED_RELAY_MS_L1_TO_L2,
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async estimateBridgeFee(params: BridgeTransferParams): Promise<BridgeFeeEstimate> {
    const bridgeAddresses = getNativeBridgeAddresses(
      params.sourceChainId,
      params.destinationChainId,
    );

    let estimatedGasSource = ESTIMATED_GAS_ARB_DEPOSIT;
    switch (bridgeAddresses.bridgeType) {
      case 'arbitrum-inbox':
        estimatedGasSource = ESTIMATED_GAS_ARB_DEPOSIT;
        break;
      case 'l1-standard-bridge':
        estimatedGasSource = ESTIMATED_GAS_OP_DEPOSIT;
        break;
      case 'l2-standard-bridge':
        estimatedGasSource = ESTIMATED_GAS_WITHDRAW;
        break;
    }

    const isL1ToL2 = this.isL1Chain(params.sourceChainId);

    this.feeHistogram.observe(
      { bridge_key: 'native', direction: isL1ToL2 ? 'l1-to-l2' : 'l2-to-l1' },
      isL1ToL2 ? 0.5 : 0,
    );

    return {
      bridgeFee: 0n,
      relayerFee: 0n,
      estimatedGasSource,
      estimatedGasDestination: 0n,
      totalEstimatedCostUsd: 0,
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async estimateRelayTime(params: BridgeTransferParams): Promise<number> {
    return this.isL1Chain(params.sourceChainId)
      ? ESTIMATED_RELAY_MS_L1_TO_L2
      : ESTIMATED_RELAY_MS_L2_TO_L1;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Submit dispatch
  // ─────────────────────────────────────────────────────────────────────

  private async submitByBridgeType(
    params: BridgeTransferParams,
    bridgeAddresses: { bridge: string; bridgeType: string },
    selectedWallet: SelectedWallet,
  ): Promise<string> {
    switch (bridgeAddresses.bridgeType) {
      case 'arbitrum-inbox':
        return this.submitArbitrumInbox(params, bridgeAddresses.bridge, selectedWallet);
      case 'l1-standard-bridge':
        return this.submitL1StandardBridge(params, bridgeAddresses.bridge, selectedWallet);
      case 'l2-standard-bridge':
        return this.submitL2StandardBridge(params, bridgeAddresses.bridge, selectedWallet);
      default:
        throw new Error(`Native bridge: unknown bridge type ${bridgeAddresses.bridgeType}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Arbitrum Inbox (L1 → L2 ETH deposit)
  // ─────────────────────────────────────────────────────────────────────

  private async submitArbitrumInbox(
    params: BridgeTransferParams,
    bridgeAddress: string,
    selectedWallet: SelectedWallet,
  ): Promise<string> {
    if (!this.isNativeEth(params.token)) {
      throw new Error(
        `Native bridge (Arbitrum): ERC20 deposits via Inbox not supported. ` +
        `Use Across or Stargate for ERC20 cross-chain transfers.`,
      );
    }

    const data = this.arbitrumInboxInterface.encodeFunctionData('depositEth');

    const gasEstimation = await this.gasEstimator.estimateGas(
      params.sourceChainId as ChainId,
      {
        to: bridgeAddress,
        data,
        value: params.amount,
        from: selectedWallet.address,
      },
    );

    if (!gasEstimation.withinPolicy) {
      throw new Error(
        `Native bridge (Arbitrum): gas price exceeds policy: ${gasEstimation.policyWarning}`,
      );
    }

    const tx = await selectedWallet.wallet.sendTransaction({
      to: bridgeAddress,
      data,
      value: params.amount,
      from: selectedWallet.address,
      gasLimit: gasEstimation.gasLimit,
      maxFeePerGas: gasEstimation.feeData.maxFeePerGas,
      maxPriorityFeePerGas: gasEstimation.feeData.maxPriorityFeePerGas,
      type: 2,
    });

    const receipt = await tx.wait(1);
    if (!receipt || receipt.status === 0) {
      this.submitCounter.inc({
        source: String(params.sourceChainId),
        dest: String(params.destinationChainId),
        status: 'reverted',
      });
      throw new Error(
        `Native bridge (Arbitrum): deposit tx ${tx.hash} reverted on source chain`,
      );
    }

    return tx.hash;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Optimism L1StandardBridge (L1 → L2 deposit)
  // ─────────────────────────────────────────────────────────────────────

  private async submitL1StandardBridge(
    params: BridgeTransferParams,
    bridgeAddress: string,
    selectedWallet: SelectedWallet,
  ): Promise<string> {
    const isNative = this.isNativeEth(params.token);

    let data: string;
    let value: bigint = 0n;

    if (isNative) {
      data = this.l1StandardBridgeInterface.encodeFunctionData('depositETH', [
        L2_GAS_LIMIT_DEPOSIT,
        '0x',
      ]);
      value = params.amount;
    } else {
      await this.ensureApproval(params, selectedWallet.address, bridgeAddress);

      data = this.l1StandardBridgeInterface.encodeFunctionData('depositERC20', [
        asAddr(params.token),
        asAddr(params.destinationToken),
        params.amount,
        L2_GAS_LIMIT_DEPOSIT,
        '0x',
      ]);
    }

    const gasEstimation = await this.gasEstimator.estimateGas(
      params.sourceChainId as ChainId,
      {
        to: bridgeAddress,
        data,
        value,
        from: selectedWallet.address,
      },
    );

    if (!gasEstimation.withinPolicy) {
      throw new Error(
        `Native bridge (L1StandardBridge): gas price exceeds policy: ${gasEstimation.policyWarning}`,
      );
    }

    const tx = await selectedWallet.wallet.sendTransaction({
      to: bridgeAddress,
      data,
      value,
      from: selectedWallet.address,
      gasLimit: gasEstimation.gasLimit,
      maxFeePerGas: gasEstimation.feeData.maxFeePerGas,
      maxPriorityFeePerGas: gasEstimation.feeData.maxPriorityFeePerGas,
      type: 2,
    });

    const receipt = await tx.wait(1);
    if (!receipt || receipt.status === 0) {
      this.submitCounter.inc({
        source: String(params.sourceChainId),
        dest: String(params.destinationChainId),
        status: 'reverted',
      });
      throw new Error(
        `Native bridge (L1StandardBridge): deposit tx ${tx.hash} reverted on source chain`,
      );
    }

    return tx.hash;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Optimism L2StandardBridge (L2 → L1 withdrawal)
  // ─────────────────────────────────────────────────────────────────────

  private async submitL2StandardBridge(
    params: BridgeTransferParams,
    bridgeAddress: string,
    selectedWallet: SelectedWallet,
  ): Promise<string> {
    const isNative = this.isNativeEth(params.token);

    let data: string;

    if (isNative) {
      data = this.l2StandardBridgeInterface.encodeFunctionData('withdraw', [
        asAddr('0xDeadDeAddeAddEAddeadDEaDDEAdDeaDDeAD0000'),
        params.amount,
        100_000,
        '0x',
      ]);
    } else {
      await this.ensureApproval(params, selectedWallet.address, bridgeAddress);

      data = this.l2StandardBridgeInterface.encodeFunctionData('bridgeERC20', [
        asAddr(params.token),
        asAddr(params.destinationToken),
        params.amount,
        100_000,
        '0x',
      ]);
    }

    const gasEstimation = await this.gasEstimator.estimateGas(
      params.sourceChainId as ChainId,
      {
        to: bridgeAddress,
        data,
        from: selectedWallet.address,
      },
    );

    if (!gasEstimation.withinPolicy) {
      throw new Error(
        `Native bridge (L2StandardBridge): gas price exceeds policy: ${gasEstimation.policyWarning}`,
      );
    }

    const tx = await selectedWallet.wallet.sendTransaction({
      to: bridgeAddress,
      data,
      from: selectedWallet.address,
      gasLimit: gasEstimation.gasLimit,
      maxFeePerGas: gasEstimation.feeData.maxFeePerGas,
      maxPriorityFeePerGas: gasEstimation.feeData.maxPriorityFeePerGas,
      type: 2,
    });

    const receipt = await tx.wait(1);
    if (!receipt || receipt.status === 0) {
      this.submitCounter.inc({
        source: String(params.sourceChainId),
        dest: String(params.destinationChainId),
        status: 'reverted',
      });
      throw new Error(
        `Native bridge (L2StandardBridge): withdrawal tx ${tx.hash} reverted on source chain`,
      );
    }

    this.logger.warn(
      `L2→L1 withdrawal initiated: hash=${tx.hash}. ` +
      `Challenge period applies — estimated finality: ~7 days.`,
    );

    return tx.hash;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────

  private async ensureApproval(
    params: BridgeTransferParams,
    ownerAddress: string,
    bridgeAddress: string,
  ): Promise<void> {
    const currentAllowance = await this.tokenApprove.getAllowance({
      chainId: params.sourceChainId as ChainId,
      tokenAddress: asAddr(params.token),
      owner: asAddr(ownerAddress),
      spender: asAddr(bridgeAddress),
    });

    if (currentAllowance >= params.amount) {
      return;
    }

    this.logger.log(
      `Insufficient allowance, approving ${params.token} for Native Bridge ${bridgeAddress}`,
    );

    const result = await this.tokenApprove.approveToken({
      chainId: params.sourceChainId as ChainId,
      tokenAddress: asAddr(params.token),
      spender: asAddr(bridgeAddress),
      amount: params.amount,
    });

    if (result.status === 'failed') {
      throw new Error(
        `Native bridge: ERC20 approve failed for ${params.token}: tx=${result.txHash}`,
      );
    }
  }

  private isNativeEth(token: string): boolean {
    return token === ZeroAddress || token === NATIVE_ETH_ADDRESS;
  }

  private isL1Chain(chainId: number): boolean {
    return chainId === (ChainId.ETHEREUM_MAINNET as number) || chainId === (ChainId.ETHEREUM_TESTNET_SEPOLIA as number);
  }

  private buildSupportedChains(): ReadonlyArray<readonly [number, number]> {
    const pairs: [number, number][] = [];
    const allKeys = [
      ...Object.keys(NATIVE_MAINNET_KEYS),
      ...Object.keys(NATIVE_TESTNET_KEYS),
    ];
    for (const key of allKeys) {
      const dashIdx = key.indexOf('-');
      const src = Number(key.substring(0, dashIdx));
      const dst = Number(key.substring(dashIdx + 1));
      pairs.push([src, dst]);
    }
    return pairs;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Metrics
  // ─────────────────────────────────────────────────────────────────────

  private initializeMetrics(): void {
    const registry = getArbibotMetricsRegistry();

    this.submitCounter = new Counter({
      name: 'arb_bridge_native_submit_total',
      help: 'Total native bridge transfer submissions',
      labelNames: ['source', 'dest', 'status'],
      registers: [registry],
    });

    this.relayLatency = new Histogram({
      name: 'arb_bridge_native_relay_duration_seconds',
      help: 'Native bridge relay duration in seconds',
      labelNames: ['source', 'dest'],
      buckets: [60, 120, 300, 600, 1800, 3600, 86400, 604800],
      registers: [registry],
    });

    this.feeHistogram = new Histogram({
      name: 'arb_bridge_native_fee_usd',
      help: 'Native bridge fee estimate in USD',
      labelNames: ['bridge_key', 'direction'],
      buckets: [0, 0.1, 0.5, 1, 5, 10],
      registers: [registry],
    });
  }
}

/** Mainnet native bridge chain-pair keys. */
const NATIVE_MAINNET_KEYS: Record<string, null> = {
  '1-42161': null,
  '42161-1': null,
  '1-8453': null,
  '8453-1': null,
};

/** Testnet native bridge chain-pair keys. */
const NATIVE_TESTNET_KEYS: Record<string, null> = {
  '11155111-421614': null,
  '421614-11155111': null,
  '11155111-84532': null,
  '84532-11155111': null,
};