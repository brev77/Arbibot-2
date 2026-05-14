import { Injectable, Logger } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

/**
 * Centralised DEX observability metrics.
 *
 * Metric names follow the `arb_dex_*` convention agreed in DEX-1-2-OBS:
 *   - arb_dex_rpc_latency_seconds     (histogram) — DEX-specific RPC call latency
 *   - arb_dex_gas_price_gwei          (gauge)     — current gas price per chain
 *   - arb_dex_swap_total              (counter)   — swaps by adapter / chain / outcome
 *   - arb_dex_confirmation_seconds    (histogram) — time from tx broadcast to receipt
 *   - arb_dex_signature_seconds       (histogram) — time to sign a transaction
 *   - arb_dex_broadcast_seconds       (histogram) — time to broadcast a signed tx
 *
 * SLO targets (DEX-1-2-OBS):
 *   - signature  < 100 ms
 *   - broadcast  < 200 ms
 *   - confirmation < 30 s (mainnet) / < 10 s (testnet)
 */
@Injectable()
export class DexMetricsService {
  private readonly logger = new Logger(DexMetricsService.name);

  private rpcLatency!: Histogram<string>;
  private gasPriceGauge!: Gauge<string>;
  private swapCounter!: Counter<string>;
  private confirmationHistogram!: Histogram<string>;
  private signatureHistogram!: Histogram<string>;
  private broadcastHistogram!: Histogram<string>;

  constructor() {
    this.initializeMetrics();
  }

  // ---------------------------------------------------------------------------
  // Recording helpers
  // ---------------------------------------------------------------------------

  /** Record a DEX-related RPC call (quote, gas estimate, etc.). */
  recordRpcLatency(chainId: number, method: string, durationMs: number): void {
    this.rpcLatency.observe(
      { chain_id: String(chainId), method },
      durationMs / 1000,
    );
  }

  /** Update current gas price for a chain. */
  setGasPrice(chainId: number, baseFeeGwei: number, priorityFeeGwei: number): void {
    this.gasPriceGauge.set(
      { chain_id: String(chainId), type: 'base_fee' },
      baseFeeGwei,
    );
    this.gasPriceGauge.set(
      { chain_id: String(chainId), type: 'priority_fee' },
      priorityFeeGwei,
    );
  }

  /** Increment swap outcome counter. */
  incrementSwap(adapter: string, chainId: number, status: 'success' | 'failed' | 'reverted'): void {
    this.swapCounter.inc({
      adapter,
      chain_id: String(chainId),
      status,
    });
  }

  /** Record tx confirmation time (broadcast → receipt). */
  recordConfirmation(chainId: number, network: 'mainnet' | 'testnet', durationMs: number): void {
    this.confirmationHistogram.observe(
      { chain_id: String(chainId), network },
      durationMs / 1000,
    );
  }

  /** Record signing latency. */
  recordSignature(chainId: number, durationMs: number): void {
    this.signatureHistogram.observe(
      { chain_id: String(chainId) },
      durationMs / 1000,
    );
  }

  /** Record broadcast latency (sendSignedTransaction → txHash). */
  recordBroadcast(chainId: number, durationMs: number): void {
    this.broadcastHistogram.observe(
      { chain_id: String(chainId) },
      durationMs / 1000,
    );
  }

  // ---------------------------------------------------------------------------
  // Timer helpers (convenient stopwatches)
  // ---------------------------------------------------------------------------

  /** Start a RPC latency timer. Call `end()` on the returned handle. */
  startRpcTimer(chainId: number, method: string): { end: () => number } {
    const start = performance.now();
    return {
      end: () => {
        const ms = performance.now() - start;
        this.recordRpcLatency(chainId, method, ms);
        return ms;
      },
    };
  }

  /** Start a confirmation timer. */
  startConfirmationTimer(chainId: number, network: 'mainnet' | 'testnet'): { end: () => number } {
    const start = performance.now();
    return {
      end: () => {
        const ms = performance.now() - start;
        this.recordConfirmation(chainId, network, ms);
        return ms;
      },
    };
  }

  /** Start a signature timer. */
  startSignatureTimer(chainId: number): { end: () => number } {
    const start = performance.now();
    return {
      end: () => {
        const ms = performance.now() - start;
        this.recordSignature(chainId, ms);
        return ms;
      },
    };
  }

  /** Start a broadcast timer. */
  startBroadcastTimer(chainId: number): { end: () => number } {
    const start = performance.now();
    return {
      end: () => {
        const ms = performance.now() - start;
        this.recordBroadcast(chainId, ms);
        return ms;
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Registry / initialisation
  // ---------------------------------------------------------------------------

  /** Expose the registry for health checks or custom queries. */
  getRegistry(): Registry {
    return getArbibotMetricsRegistry();
  }

  private initializeMetrics(): void {
    const registry = getArbibotMetricsRegistry();

    this.rpcLatency = new Histogram({
      name: 'arb_dex_rpc_latency_seconds',
      help: 'DEX-specific RPC call latency in seconds',
      labelNames: ['chain_id', 'method'] as const,
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [registry],
    });

    this.gasPriceGauge = new Gauge({
      name: 'arb_dex_gas_price_gwei',
      help: 'Current gas price in GWei per chain (base_fee / priority_fee)',
      labelNames: ['chain_id', 'type'] as const,
      registers: [registry],
    });

    this.swapCounter = new Counter({
      name: 'arb_dex_swap_total',
      help: 'Total DEX swap operations by adapter, chain and outcome',
      labelNames: ['adapter', 'chain_id', 'status'] as const,
      registers: [registry],
    });

    this.confirmationHistogram = new Histogram({
      name: 'arb_dex_confirmation_seconds',
      help: 'Transaction confirmation latency (broadcast → receipt) in seconds',
      labelNames: ['chain_id', 'network'] as const,
      buckets: [1, 2, 5, 10, 15, 30, 60, 120, 300],
      registers: [registry],
    });

    this.signatureHistogram = new Histogram({
      name: 'arb_dex_signature_seconds',
      help: 'Transaction signing latency in seconds',
      labelNames: ['chain_id'] as const,
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5],
      registers: [registry],
    });

    this.broadcastHistogram = new Histogram({
      name: 'arb_dex_broadcast_seconds',
      help: 'Transaction broadcast latency (sendSignedTransaction → txHash) in seconds',
      labelNames: ['chain_id'] as const,
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
      registers: [registry],
    });

    this.logger.log('DEX metrics initialized');
  }
}