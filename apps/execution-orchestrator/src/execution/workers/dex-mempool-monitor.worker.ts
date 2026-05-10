import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JsonRpcProvider, TransactionResponse } from 'ethers';
import { Counter, Gauge } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import { RpcProviderManager } from '../rpc/rpc-provider-manager.service';

/**
 * MEV threat types detected by the mempool monitor.
 */
export type MevThreatType = 'frontrun' | 'sandwich' | 'backrun' | 'unknown';

/**
 * Represents a decoded DEX swap from a pending mempool transaction.
 */
export interface DecodedMempoolSwap {
  txHash: string;
  chainId: number;
  from: string;
  to: string; // router address
  tokenIn?: string;
  tokenOut?: string;
  amountIn?: bigint;
  gasPrice: bigint;
  maxPriorityFeePerGas?: bigint;
  nonce: number;
  blockNumber: number | null;
}

/**
 * MEV detection result — returned by checkMevRisk().
 */
export interface MevRiskAssessment {
  riskLevel: 'low' | 'medium' | 'high';
  threats: MevThreatInfo[];
  analyzedTxCount: number;
}

/**
 * Detailed info about a specific MEV threat.
 */
export interface MevThreatInfo {
  type: MevThreatType;
  description: string;
  suspiciousTxHash: string;
  tokenPair: string;
  gasPremiumBps?: number;
}

/**
 * Pending swap tracking entry for pattern detection.
 */
interface PendingSwapEntry {
  txHash: string;
  tokenIn: string;
  tokenOut: string;
  gasPrice: bigint;
  maxPriorityFeePerGas?: bigint;
  timestamp: number;
  from: string;
}

/**
 * Configuration for the mempool monitor.
 */
export interface DexMempoolMonitorConfig {
  /** Enable/disable mempool monitoring */
  enabled: boolean;
  /** Chain IDs to monitor */
  chainIds: number[];
  /** DEX router addresses to watch (lowercase) */
  routerAddresses: string[];
  /** Time window (ms) to keep pending swaps for analysis */
  analysisWindowMs: number;
  /** Gas price premium threshold (basis points) for frontrun detection */
  frontrunGasPremiumBps: number;
  /** Maximum pending swaps to track per chain */
  maxPendingSwapsPerChain: number;
}

const DEFAULT_CONFIG: DexMempoolMonitorConfig = {
  enabled: false,
  chainIds: [42161],
  routerAddresses: [],
  analysisWindowMs: 30_000, // 30 seconds
  frontrunGasPremiumBps: 500, // 5% gas premium = frontrun suspicion
  maxPendingSwapsPerChain: 500,
};

/**
 * DexMempoolMonitorWorker
 * Step: DEX-1-2-MEMPOOL
 *
 * Monitors the Ethereum mempool for pending DEX swap transactions.
 * Detects MEV patterns: frontrun, sandwich, backrun.
 * Exposes checkMevRisk() for the execution orchestrator to assess
 * MEV risk before submitting a transaction.
 *
 * Architecture notes:
 * - Read-only: does not modify any state in the execution pipeline
 * - Subscribes to pending transactions via ethers.js provider
 * - Decodes swap function selectors for configured DEX routers
 * - Maintains a sliding window of recent pending swaps
 * - Detection is heuristic-based; false positives are possible
 */
@Injectable()
export class DexMempoolMonitorWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DexMempoolMonitorWorker.name);

  private config: DexMempoolMonitorConfig;
  private pendingSwaps = new Map<number, PendingSwapEntry[]>();
  private subscriptions = new Map<number, () => void>();
  private cleanupTimer?: NodeJS.Timeout;
  private mevDetectedCounter!: Counter<string>;
  private pendingSwapsGauge!: Gauge<string>;

  constructor(private readonly rpcManager: RpcProviderManager) {
    this.config = this.loadConfig();
    this.initializeMetrics();
  }

  onModuleInit(): void {
    if (!this.config.enabled) {
      this.logger.log('Mempool monitoring is disabled (DEX_MEMPOOL_ENABLED not set)');
      return;
    }

    this.logger.log('Starting mempool monitoring worker');
    this.startMonitoring();
    this.startCleanup();
  }

  onModuleDestroy(): void {
    this.stopMonitoring();
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Check MEV risk for a planned swap.
   *
   * Call before submitting a DEX transaction to assess whether
   * there is suspicious activity in the mempool for the same token pair.
   */
  checkMevRisk(params: {
    chainId: number;
    tokenIn: string;
    tokenOut: string;
    ourGasPrice: bigint;
  }): MevRiskAssessment {
    const { chainId, tokenIn, tokenOut, ourGasPrice } = params;
    const swaps = this.pendingSwaps.get(chainId) ?? [];
    const threats: MevThreatInfo[] = [];

    const tokenInLower = tokenIn.toLowerCase();
    const tokenOutLower = tokenOut.toLowerCase();
    const pairKey = `${tokenInLower}/${tokenOutLower}`;

    // Filter swaps matching our token pair
    const matchingSwaps = swaps.filter(
      (s) =>
        s.tokenIn.toLowerCase() === tokenInLower &&
        s.tokenOut.toLowerCase() === tokenOutLower,
    );

    for (const swap of matchingSwaps) {
      // --- Frontrun detection: same pair, higher gas price from different address ---
      const gasPremiumBps = this.calculateGasPremiumBps(swap.gasPrice, ourGasPrice);
      if (gasPremiumBps > this.config.frontrunGasPremiumBps) {
        const threat: MevThreatInfo = {
          type: 'frontrun',
          description: `Pending tx ${swap.txHash.slice(0, 16)}… pays ${gasPremiumBps} bps more gas for ${pairKey}`,
          suspiciousTxHash: swap.txHash,
          tokenPair: pairKey,
          gasPremiumBps,
        };
        threats.push(threat);
        this.logger.warn(`MEV detected: frontrun — ${threat.description}`);
        this.mevDetectedCounter.inc({ type: 'frontrun', chain_id: String(chainId) });
      }

      // --- Backrun detection: same pair, slightly lower gas, after our tx ---
      if (gasPremiumBps < -200) {
        // Another tx with significantly lower gas following our pair
        threats.push({
          type: 'backrun',
          description: `Pending tx ${swap.txHash.slice(0, 16)}… follows ${pairKey} with lower gas`,
          suspiciousTxHash: swap.txHash,
          tokenPair: pairKey,
          gasPremiumBps,
        });
        this.mevDetectedCounter.inc({ type: 'backrun', chain_id: String(chainId) });
      }
    }

    // --- Sandwich detection: frontrun buy + backrun sell for same pair ---
    const reverseSwaps = swaps.filter(
      (s) =>
        s.tokenIn.toLowerCase() === tokenOutLower &&
        s.tokenOut.toLowerCase() === tokenInLower,
    );
    if (matchingSwaps.length > 0 && reverseSwaps.length > 0) {
      // Check if there's a frontrun (same direction) + backrun (reverse direction) pair
      const frontrunSwaps = matchingSwaps.filter(
        (s) => this.calculateGasPremiumBps(s.gasPrice, ourGasPrice) > this.config.frontrunGasPremiumBps,
      );
      for (const front of frontrunSwaps) {
        for (const back of reverseSwaps) {
          if (back.timestamp > front.timestamp) {
            threats.push({
              type: 'sandwich',
              description: `Sandwich detected: frontrun ${front.txHash.slice(0, 16)}… + backrun ${back.txHash.slice(0, 16)}… on ${pairKey}`,
              suspiciousTxHash: front.txHash,
              tokenPair: pairKey,
            });
            this.logger.warn(`MEV detected: sandwich — frontrun + backrun on ${pairKey}`);
            this.mevDetectedCounter.inc({ type: 'sandwich', chain_id: String(chainId) });
          }
        }
      }
    }

    // Determine overall risk level
    const riskLevel = this.calculateRiskLevel(threats);

    return {
      riskLevel,
      threats,
      analyzedTxCount: matchingSwaps.length + reverseSwaps.length,
    };
  }

  /**
   * Get current pending swap count per chain.
   */
  getPendingSwapCounts(): Map<number, number> {
    const result = new Map<number, number>();
    for (const [chainId, swaps] of this.pendingSwaps.entries()) {
      result.set(chainId, swaps.length);
    }
    return result;
  }

  /**
   * Get the current configuration.
   */
  getConfig(): DexMempoolMonitorConfig {
    return { ...this.config };
  }

  // ---------------------------------------------------------------------------
  // Monitoring lifecycle
  // ---------------------------------------------------------------------------

  private startMonitoring(): void {
    for (const chainId of this.config.chainIds) {
      try {
        const provider = this.rpcManager.getProvider(chainId) as JsonRpcProvider;
        if (!provider) {
          this.logger.warn(`No provider for chain ${chainId}, skipping mempool monitoring`);
          continue;
        }

        this.pendingSwaps.set(chainId, []);

        // Subscribe to pending transactions
        const handler = (txHash: string) => {
          void this.processPendingTx(txHash, chainId, provider);
        };

        void provider.on('pending', handler);
        this.subscriptions.set(chainId, () => {
          void provider.off('pending', handler);
        });

        this.logger.log(`Mempool monitoring started for chain ${chainId}`);
      } catch (error) {
        this.logger.error(`Failed to start mempool monitoring for chain ${chainId}: ${String(error)}`);
      }
    }
  }

  private stopMonitoring(): void {
    for (const [chainId, unsub] of this.subscriptions.entries()) {
      unsub();
      this.logger.log(`Mempool monitoring stopped for chain ${chainId}`);
    }
    this.subscriptions.clear();
  }

  // ---------------------------------------------------------------------------
  // Pending transaction processing
  // ---------------------------------------------------------------------------

  private async processPendingTx(txHash: string, chainId: number, provider: JsonRpcProvider): Promise<void> {
    try {
      const tx = await provider.getTransaction(txHash);
      if (!tx || !tx.to) return;

      const toLower = tx.to.toLowerCase();
      if (!this.config.routerAddresses.map((a) => a.toLowerCase()).includes(toLower)) {
        return;
      }

      const decoded = this.decodeSwap(tx, chainId);
      if (!decoded) return;

      const entry: PendingSwapEntry = {
        txHash: tx.hash,
        tokenIn: decoded.tokenIn ?? '',
        tokenOut: decoded.tokenOut ?? '',
        gasPrice: tx.gasPrice ?? 0n,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? undefined,
        timestamp: Date.now(),
        from: tx.from,
      };

      const swaps = this.pendingSwaps.get(chainId) ?? [];

      // Enforce max limit
      if (swaps.length >= this.config.maxPendingSwapsPerChain) {
        swaps.shift();
      }

      swaps.push(entry);
      this.pendingSwaps.set(chainId, swaps);
    } catch {
      // Ignore individual tx processing errors (RPC timeouts, etc.)
    }
  }

  // ---------------------------------------------------------------------------
  // Swap decoding (heuristic — function selectors)
  // ---------------------------------------------------------------------------

  /**
   * Known DEX swap function selectors (4-byte).
   * - swapExactTokensForTokens: 0x38ed1739
   * - swapExactETHForTokens:    0x7ff36ab5
   * - swapExactTokensForETH:    0x18cbafe5
   * - swapTokensForExactTokens: 0x8803dbee
   * - swapTokensForExactETH:    0xfb3bdb41
   * - exactInputSingle (V3):    0x04e45aaf
   * - exactInput (V3):          0xb858183f
   * - exactOutputSingle (V3):   0x5023b4df
   * - exactOutput (V3):         0xf28c0498
   */
  private static readonly SWAP_SELECTORS = new Set([
    '0x38ed1739',
    '0x7ff36ab5',
    '0x18cbafe5',
    '0x8803dbee',
    '0xfb3bdb41',
    '0x04e45aaf',
    '0xb858183f',
    '0x5023b4df',
    '0xf28c0498',
  ]);

  /**
   * Attempt to decode a swap from a transaction's calldata.
   * Returns a partial DecodedMempoolSwap — full path decoding is
   * optional; token addresses may not always be extractable.
   */
  private decodeSwap(tx: TransactionResponse, chainId: number): DecodedMempoolSwap | null {
    if (!tx.data || tx.data.length < 10) return null;

    const selector = tx.data.slice(0, 10).toLowerCase();
    if (!DexMempoolMonitorWorker.SWAP_SELECTORS.has(selector)) return null;

    const decoded: DecodedMempoolSwap = {
      txHash: tx.hash,
      chainId,
      from: tx.from,
      to: tx.to ?? '',
      gasPrice: tx.gasPrice ?? 0n,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? undefined,
      nonce: tx.nonce,
      blockNumber: tx.blockNumber,
    };

    // For V2-style swaps, try to extract token addresses from the path parameter
    // swapExactTokensForTokens(uint256,uint256,address[],address,uint256)
    // selector + amountIn (32) + amountOutMin (32) + path offset (32) + ...
    try {
      if (selector === '0x38ed1739' && tx.data.length >= 74) {
        // Path offset is at position 4 + 32 + 32 = 68 bytes from start
        const pathOffset = Number(this.readUint256(tx.data, 4 + 32 + 32));
        // Path is at this offset in the data: length + addresses
        if (pathOffset * 2 + 10 <= tx.data.length) {
          const pathLenPos = pathOffset;
          const pathLen = Number(this.readUint256(tx.data, pathLenPos));
          if (pathLen >= 2) {
            decoded.tokenIn = this.readAddress(tx.data, pathLenPos + 32);
            decoded.tokenOut = this.readAddress(tx.data, pathLenPos + 32 + (pathLen - 1) * 32);
          }
        }
      } else if (selector === '0x04e45aaf') {
        // exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))
        // Struct is at offset 4
        if (tx.data.length >= 4 + 32 * 7 + 4) {
          decoded.tokenIn = this.readAddress(tx.data, 4 + 32); // skip struct offset
          decoded.tokenOut = this.readAddress(tx.data, 4 + 32 + 32);
        }
      }
    } catch {
      // Decoding failure is non-fatal — we still track the swap
    }

    return decoded;
  }

  // ---------------------------------------------------------------------------
  // MEV detection helpers
  // ---------------------------------------------------------------------------

  private calculateGasPremiumBps(theirGas: bigint, ourGas: bigint): number {
    if (ourGas === 0n) return 0;
    const diff = theirGas - ourGas;
    // bps = (diff / ourGas) * 10000
    const bps = Number((diff * 10_000n) / ourGas);
    return bps;
  }

  private calculateRiskLevel(threats: MevThreatInfo[]): 'low' | 'medium' | 'high' {
    if (threats.length === 0) return 'low';
    const hasFrontrun = threats.some((t) => t.type === 'frontrun');
    const hasSandwich = threats.some((t) => t.type === 'sandwich');
    if (hasSandwich) return 'high';
    if (hasFrontrun && threats.length >= 2) return 'high';
    if (hasFrontrun) return 'medium';
    return 'medium';
  }

  // ---------------------------------------------------------------------------
  // Calldata parsing helpers
  // ---------------------------------------------------------------------------

  private readUint256(data: string, byteOffset: number): bigint {
    const hex = data.slice(2 + byteOffset * 2, 2 + byteOffset * 2 + 64);
    return BigInt('0x' + hex);
  }

  private readAddress(data: string, byteOffset: number): string {
    // Address is in the last 20 bytes of a 32-byte slot
    const start = 2 + byteOffset * 2 + 24; // skip first 12 bytes of slot
    return '0x' + data.slice(start, start + 40);
  }

  // ---------------------------------------------------------------------------
  // Maintenance
  // ---------------------------------------------------------------------------

  private startCleanup(): void {
    const CLEANUP_INTERVAL_MS = 10_000; // 10 seconds
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, CLEANUP_INTERVAL_MS);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [chainId, swaps] of this.pendingSwaps.entries()) {
      const cutoff = now - this.config.analysisWindowMs;
      const filtered = swaps.filter((s) => s.timestamp >= cutoff);
      this.pendingSwaps.set(chainId, filtered);

      // Update gauge
      this.pendingSwapsGauge.set({ chain_id: String(chainId) }, filtered.length);
    }
  }

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  private loadConfig(): DexMempoolMonitorConfig {
    const enabled = process.env.DEX_MEMPOOL_ENABLED === 'true';
    const chainIds = (process.env.DEX_MEMPOOL_CHAIN_IDS ?? '42161')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => !isNaN(n));

    // Default router addresses for known DEXes on Arbitrum
    const defaultRouters = [
      '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24', // Uniswap V2 Router
      '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', // Uniswap V3 SwapRouter02
      '0xe592427A0AEce92De3Edee1F18E0157C05861564', // Uniswap V3 SwapRouter
      '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', // SushiSwap V2 Router
    ];
    const routerAddresses = (process.env.DEX_MEMPOOL_ROUTER_ADDRESSES ?? defaultRouters.join(','))
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);

    return {
      ...DEFAULT_CONFIG,
      enabled,
      chainIds,
      routerAddresses,
      analysisWindowMs: Number(process.env.DEX_MEMPOOL_ANALYSIS_WINDOW_MS ?? DEFAULT_CONFIG.analysisWindowMs),
      frontrunGasPremiumBps: Number(process.env.DEX_MEMPOOL_FRONTRUN_GAS_PREMIUM_BPS ?? DEFAULT_CONFIG.frontrunGasPremiumBps),
      maxPendingSwapsPerChain: Number(process.env.DEX_MEMPOOL_MAX_PENDING ?? DEFAULT_CONFIG.maxPendingSwapsPerChain),
    };
  }

  // ---------------------------------------------------------------------------
  // Metrics
  // ---------------------------------------------------------------------------

  private initializeMetrics(): void {
    const registry = getArbibotMetricsRegistry();

    this.mevDetectedCounter = new Counter({
      name: 'arb_dex_mev_detected_total',
      help: 'Total MEV threats detected by the mempool monitor',
      labelNames: ['type', 'chain_id'],
      registers: [registry],
    });

    this.pendingSwapsGauge = new Gauge({
      name: 'arb_dex_mempool_pending_swaps',
      help: 'Current number of tracked pending DEX swaps in the mempool',
      labelNames: ['chain_id'],
      registers: [registry],
    });
  }
}