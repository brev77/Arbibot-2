import { Injectable, Logger } from '@nestjs/common';
import { Provider, TransactionRequest, formatUnits } from 'ethers';
import { Histogram, Gauge, Counter } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { ChainId } from '@arbibot/contracts-eth';

import { RpcProviderManager } from '../rpc/rpc-provider-manager.service';

/**
 * Gas policy limits per chain
 */
export interface GasPolicy {
  /** Maximum total gas price in GWEI (maxFeePerGas cap) */
  maxFeePerGasGwei: number;
  /** Maximum priority fee in GWEI (maxPriorityFeePerGas cap) */
  maxPriorityFeeGwei: number;
  /** Gas limit multiplier (safety buffer, e.g. 1.15 = 15% buffer) */
  gasLimitMultiplier: number;
  /** Whether to reject transactions that exceed maxFeePerGas */
  rejectOnExceed: boolean;
}

/**
 * EIP-1559 fee parameters
 */
export interface Eip1559FeeData {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  baseFee: bigint;
  /** Formatted GWEI string for logging */
  maxFeePerGasGwei: string;
  maxPriorityFeePerGasGwei: string;
  baseFeeGwei: string;
}

/**
 * Gas estimation result
 */
export interface GasEstimationResult {
  /** Estimated gas limit for the transaction */
  gasLimit: bigint;
  /** EIP-1559 fee data */
  feeData: Eip1559FeeData;
  /** Total estimated gas cost in wei */
  estimatedCostWei: bigint;
  /** Estimated cost formatted in ETH */
  estimatedCostEth: string;
  /** Whether the gas price is within policy limits */
  withinPolicy: boolean;
  /** Warning if gas price exceeds policy */
  policyWarning?: string;
}

/**
 * GasEstimatorService — Step DEX-1-0-GAS
 *
 * Estimates gas for DEX transactions with EIP-1559 fee support.
 * Enforces max gas price policy from environment configuration.
 * Tracks Prometheus metrics for gas estimation latency and gas prices.
 */
@Injectable()
export class GasEstimatorService {
  private readonly logger = new Logger(GasEstimatorService.name);

  /** Default gas policy values */
  private static readonly DEFAULT_MAX_FEE_GWEI = 50;
  private static readonly DEFAULT_MAX_PRIORITY_FEE_GWEI = 2;
  private static readonly DEFAULT_GAS_LIMIT_MULTIPLIER = 1.15;

  // Metrics
  private estimateLatency!: Histogram<string>;
  private gasPriceGauge!: Gauge<string>;
  private policyRejectionCounter!: Counter<string>;

  constructor(private readonly rpcProviderManager: RpcProviderManager) {
    this.initializeMetrics();
  }

  /**
   * Get current gas policy for a chain
   */
  getGasPolicy(chainId: ChainId): GasPolicy {
    // Per-chain overrides via env: GAS_POLICY_{CHAINID}_MAX_FEE_GWEI
    const chainMaxFee = process.env[`GAS_POLICY_${chainId}_MAX_FEE_GWEI`];
    const chainMaxPriority = process.env[`GAS_POLICY_${chainId}_MAX_PRIORITY_FEE_GWEI`];

    return {
      maxFeePerGasGwei: chainMaxFee
        ? Number(chainMaxFee)
        : Number(process.env.MAX_GAS_PRICE_GWEI) || GasEstimatorService.DEFAULT_MAX_FEE_GWEI,
      maxPriorityFeeGwei: chainMaxPriority
        ? Number(chainMaxPriority)
        : Number(process.env.MAX_PRIORITY_FEE_GWEI) || GasEstimatorService.DEFAULT_MAX_PRIORITY_FEE_GWEI,
      gasLimitMultiplier: Number(process.env.GAS_LIMIT_MULTIPLIER) || GasEstimatorService.DEFAULT_GAS_LIMIT_MULTIPLIER,
      rejectOnExceed: process.env.GAS_REJECT_ON_EXCEED !== 'false', // default true
    };
  }

  /**
   * Get current EIP-1559 fee data for a chain
   */
  async getEip1559FeeData(chainId: ChainId): Promise<Eip1559FeeData> {
    const provider = this.rpcProviderManager.getProvider(chainId);
    const feeData = await provider.getFeeData();

    const maxFeePerGas = feeData.maxFeePerGas ?? 0n;
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 0n;

    // Get base fee from latest block
    const block = await provider.getBlock('latest');
    const baseFee = block?.baseFeePerGas ?? 0n;

    return {
      maxFeePerGas,
      maxPriorityFeePerGas,
      baseFee,
      maxFeePerGasGwei: formatUnits(maxFeePerGas, 'gwei'),
      maxPriorityFeePerGasGwei: formatUnits(maxPriorityFeePerGas, 'gwei'),
      baseFeeGwei: formatUnits(baseFee, 'gwei'),
    };
  }

  /**
   * Estimate gas for a transaction
   *
   * @param chainId - Target chain ID
   * @param txRequest - Transaction request (to, data, value, from, etc.)
   * @returns Gas estimation result with policy check
   */
  async estimateGas(chainId: ChainId, txRequest: TransactionRequest): Promise<GasEstimationResult> {
    const timer = this.estimateLatency.startTimer({ chain_id: String(chainId) });

    try {
      const provider = this.rpcProviderManager.getProvider(chainId);
      const policy = this.getGasPolicy(chainId);

      // Estimate gas limit
      const estimatedGasLimit = await provider.estimateGas(txRequest);

      // Apply safety buffer multiplier
      const gasLimit = BigInt(Math.ceil(Number(estimatedGasLimit) * policy.gasLimitMultiplier));

      // Get EIP-1559 fee data
      const feeData = await this.getEip1559FeeData(chainId);

      // Calculate total cost
      const estimatedCostWei = gasLimit * feeData.maxFeePerGas;
      const estimatedCostEth = formatUnits(estimatedCostWei, 'ether');

      // Policy check: maxFeePerGas
      const maxFeeGwei = Number(feeData.maxFeePerGasGwei);
      const withinPolicy = maxFeeGwei <= policy.maxFeePerGasGwei;

      let policyWarning: string | undefined;
      if (!withinPolicy) {
        policyWarning = `Gas price ${maxFeeGwei.toFixed(2)} GWEI exceeds policy max ${policy.maxFeePerGasGwei} GWEI for chain ${chainId}`;
        this.logger.warn(policyWarning);
        this.policyRejectionCounter.inc({ chain_id: String(chainId), reason: 'max_fee_exceeded' });
      }

      // Priority fee check
      const priorityFeeGwei = Number(feeData.maxPriorityFeePerGasGwei);
      if (priorityFeeGwei > policy.maxPriorityFeeGwei) {
        const priorityWarning = `Priority fee ${priorityFeeGwei.toFixed(2)} GWEI exceeds policy max ${policy.maxPriorityFeeGwei} GWEI for chain ${chainId}`;
        this.logger.warn(priorityWarning);
        if (!policyWarning) {
          policyWarning = priorityWarning;
        }
        this.policyRejectionCounter.inc({ chain_id: String(chainId), reason: 'priority_fee_exceeded' });
      }

      // Update metrics
      this.gasPriceGauge.set(
        { chain_id: String(chainId), type: 'max_fee' },
        maxFeeGwei,
      );
      this.gasPriceGauge.set(
        { chain_id: String(chainId), type: 'base_fee' },
        Number(feeData.baseFeeGwei),
      );
      this.gasPriceGauge.set(
        { chain_id: String(chainId), type: 'priority_fee' },
        priorityFeeGwei,
      );

      this.logger.debug(
        `Gas estimation for chain ${chainId}: gasLimit=${gasLimit}, maxFee=${feeData.maxFeePerGasGwei} GWEI, ` +
        `priorityFee=${feeData.maxPriorityFeePerGasGwei} GWEI, baseFee=${feeData.baseFeeGwei} GWEI, ` +
        `estimatedCost=${estimatedCostEth} ETH, withinPolicy=${withinPolicy}`,
      );

      return {
        gasLimit,
        feeData,
        estimatedCostWei,
        estimatedCostEth,
        withinPolicy,
        policyWarning,
      };
    } catch (error) {
      this.logger.error(`Gas estimation failed for chain ${chainId}:`, error);
      throw error;
    } finally {
      timer();
    }
  }

  /**
   * Check if a transaction should be rejected based on gas policy
   */
  shouldReject(chainId: ChainId, feeData: Eip1559FeeData): boolean {
    const policy = this.getGasPolicy(chainId);

    if (!policy.rejectOnExceed) {
      return false;
    }

    const maxFeeGwei = Number(feeData.maxFeePerGasGwei);
    const priorityFeeGwei = Number(feeData.maxPriorityFeePerGasGwei);

    return maxFeeGwei > policy.maxFeePerGasGwei || priorityFeeGwei > policy.maxPriorityFeeGwei;
  }

  /**
   * Get capped fee data that respects the gas policy
   * Clamps maxFeePerGas and maxPriorityFeePerGas to policy limits
   */
  async getCappedFeeData(chainId: ChainId): Promise<Eip1559FeeData> {
    const feeData = await this.getEip1559FeeData(chainId);
    const policy = this.getGasPolicy(chainId);

    // Convert policy GWEI limits to BigInt wei (1 GWEI = 1e9 wei)
    const GWEI = 1_000_000_000n;
    const policyMaxFeeWei = BigInt(Math.floor(policy.maxFeePerGasGwei)) * GWEI;
    const policyMaxPriorityWei = BigInt(Math.floor(policy.maxPriorityFeeGwei)) * GWEI;

    // Clamp values
    const cappedMaxFee = feeData.maxFeePerGas > policyMaxFeeWei
      ? policyMaxFeeWei
      : feeData.maxFeePerGas;
    const cappedPriority = feeData.maxPriorityFeePerGas > policyMaxPriorityWei
      ? policyMaxPriorityWei
      : feeData.maxPriorityFeePerGas;

    return {
      maxFeePerGas: cappedMaxFee,
      maxPriorityFeePerGas: cappedPriority,
      baseFee: feeData.baseFee,
      maxFeePerGasGwei: formatUnits(cappedMaxFee, 'gwei'),
      maxPriorityFeePerGasGwei: formatUnits(cappedPriority, 'gwei'),
      baseFeeGwei: feeData.baseFeeGwei,
    };
  }

  private initializeMetrics(): void {
    const registry = getArbibotMetricsRegistry();

    this.estimateLatency = new Histogram({
      name: 'arb_gas_estimate_seconds',
      help: 'Gas estimation latency in seconds',
      labelNames: ['chain_id'],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [registry],
    });

    this.gasPriceGauge = new Gauge({
      name: 'arb_gas_price_gwei',
      help: 'Current gas price in GWEI',
      labelNames: ['chain_id', 'type'],
      registers: [registry],
    });

    this.policyRejectionCounter = new Counter({
      name: 'arb_gas_policy_rejections_total',
      help: 'Total gas policy rejections',
      labelNames: ['chain_id', 'reason'],
      registers: [registry],
    });
  }
}