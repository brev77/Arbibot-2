import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Provider, JsonRpcProvider, FallbackProvider } from 'ethers';
import { Histogram, Counter } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

/**
 * RPC Provider Manager
 * Step: DEX-1-0-RPC
 * 
 * Manages RPC providers with failover and health monitoring
 */
@Injectable()
export class RpcProviderManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RpcProviderManager.name);

  private providers = new Map<number, { primary: JsonRpcProvider; backup?: JsonRpcProvider; combined?: FallbackProvider }>();
  private healthStatus = new Map<number, { healthy: boolean; latency: number; error?: string }>();
  private latencyMetrics = new Map<number, Histogram<string>>();
  private failureMetrics = new Map<number, Counter<string>>();
  private sharedLatencyHistogram?: Histogram<string>;
  private sharedFailureCounter?: Counter<string>;

  // Configuration
  private readonly LATENCY_THRESHOLD_MS = 100; // SLO: p95 < 100ms
  private readonly HEALTH_CHECK_INTERVAL_MS = 30000; // 30 seconds
  private healthCheckTimer?: NodeJS.Timeout;

  constructor() {
    this.initializeMetrics();
  }

  onModuleInit() {
    this.logger.log('Initializing RPC Provider Manager');
    this.initializeProviders();
    this.startHealthChecks();
  }

  onModuleDestroy() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
    this.providers.clear();
    this.healthStatus.clear();
  }

  /**
   * Initialize RPC providers from environment variables
   * Expected env vars:
   * - RPC_ARBITRUM_MAINNET_URL
   * - RPC_ARBITRUM_MAINNET_BACKUP_URL (optional)
   * - RPC_ARBITRUM_TESTNET_URL
   * - RPC_ARBITRUM_TESTNET_BACKUP_URL (optional)
   * - RPC_BASE_MAINNET_URL
   * - RPC_BASE_MAINNET_BACKUP_URL (optional)
   * - RPC_BASE_TESTNET_URL
   * - RPC_BASE_TESTNET_BACKUP_URL (optional)
   * - RPC_BNB_MAINNET_URL
   * - RPC_BNB_MAINNET_BACKUP_URL (optional)
   * - RPC_BNB_TESTNET_URL
   * - RPC_BNB_TESTNET_BACKUP_URL (optional)
   */
  private initializeProviders() {
    const configs = [
      { chainId: 42161, primary: process.env.RPC_ARBITRUM_MAINNET_URL, backup: process.env.RPC_ARBITRUM_MAINNET_BACKUP_URL },
      // P8-2(d): Arbitrum Sepolia = 421614 (ChainId.ARBITRUM_ONE_SEPOLIA).
      // Previously 421611 — a deprecated Arbitrum testnet id that no public RPC
      // honours, so testnet smoke hit a non-matching network. 421614 is the
      // chain id every Sepolia RPC endpoint enforces.
      { chainId: 421614, primary: process.env.RPC_ARBITRUM_TESTNET_URL, backup: process.env.RPC_ARBITRUM_TESTNET_BACKUP_URL },
      { chainId: 8453, primary: process.env.RPC_BASE_MAINNET_URL, backup: process.env.RPC_BASE_MAINNET_BACKUP_URL },
      { chainId: 84532, primary: process.env.RPC_BASE_TESTNET_URL, backup: process.env.RPC_BASE_TESTNET_BACKUP_URL },
      { chainId: 56, primary: process.env.RPC_BNB_MAINNET_URL, backup: process.env.RPC_BNB_MAINNET_BACKUP_URL },
      { chainId: 97, primary: process.env.RPC_BNB_TESTNET_URL, backup: process.env.RPC_BNB_TESTNET_BACKUP_URL },
    ];

    for (const config of configs) {
      if (!config.primary) {
        this.logger.warn(`No RPC URL configured for chain ${config.chainId}, skipping`);
        continue;
      }

      try {
        // Pin the network with `staticNetwork: true`. ethers v6 `getNetwork()` compares the
        // cached network against a fresh `_detectNetwork()` on every call; without a pin that
        // triggers a background `eth_chainId` round-trip per request. A load-balanced RPC
        // (QuickNode Arbitrum) sometimes routes that call to an Ethereum-mainnet node (chainId=1)
        // instead of Arbitrum (42161); the mismatch then throws
        // `NETWORK_ERROR: network changed: 1 => 42161` and bricks every PriceOracle read.
        //
        // With the pin, `_detectNetwork()` returns the cached network WITHOUT an RPC call
        // (ethers@6.17.0 provider-jsonrpc.js `_detectNetwork`), so the comparison is always
        // 42161===42161 and `NETWORK_ERROR` cannot fire on load-balancer drift. The prior
        // commit 6bbe45e reverted this pin under the opposite claim — that was incorrect: the
        // `network changed` symptom is caused by the ABSENCE of a pin, not its presence.
        //
        // Trade-off: a pin masks a persistent env misconfiguration (URL points at the wrong
        // chain). That is covered by the `ci-address-checksum` guard and `/health/rpc`.
        const primary = new JsonRpcProvider(config.primary, config.chainId, { staticNetwork: true });
        let backup: JsonRpcProvider | undefined;
        let combined: FallbackProvider | undefined;

        if (config.backup) {
          backup = new JsonRpcProvider(config.backup, config.chainId, { staticNetwork: true });
          // Create fallback provider with primary as priority
          combined = new FallbackProvider([primary, backup], 1);
        }

        this.providers.set(config.chainId, { primary, backup, combined });
        this.healthStatus.set(config.chainId, { healthy: true, latency: 0 });

        // Initialize metrics for this chain
        this.initializeChainMetrics(config.chainId);

        this.logger.log(`RPC provider initialized for chain ${config.chainId} (primary${backup ? ' + backup' : ''})`);
      } catch (error) {
        this.logger.error(`Failed to initialize RPC provider for chain ${config.chainId}:`, error);
        this.healthStatus.set(config.chainId, { healthy: false, latency: Infinity, error: String(error) });
      }
    }
  }

  /**
   * Get provider for a specific chain
   * Returns combined provider if backup is configured, otherwise primary
   */
  getProvider(chainId: number): Provider {
    const config = this.providers.get(chainId);
    if (!config) {
      throw new Error(`No RPC provider configured for chain ${chainId}`);
    }

    const status = this.healthStatus.get(chainId);
    if (!status?.healthy) {
      this.logger.warn(`RPC provider for chain ${chainId} is unhealthy, returning anyway`);
    }

    // Return combined provider if available, otherwise primary
    return config.combined || config.primary;
  }

  /**
   * Get health status for a chain
   */
  getHealthStatus(chainId: number): { healthy: boolean; latency: number; error?: string } | undefined {
    return this.healthStatus.get(chainId);
  }

  /**
   * Get health status for all chains
   */
  getAllHealthStatus(): Map<number, { healthy: boolean; latency: number; error?: string }> {
    return new Map(this.healthStatus);
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks() {
    this.healthCheckTimer = setInterval(() => {
      void this.runHealthChecks();
    }, this.HEALTH_CHECK_INTERVAL_MS);

    // Don't keep process alive for health checks
    if (this.healthCheckTimer.unref) {
      this.healthCheckTimer.unref();
    }

    // Run initial health check
    void this.runHealthChecks();
  }

  /**
   * Run health checks for all providers
   */
  private async runHealthChecks() {
    for (const [chainId, config] of this.providers.entries()) {
      await this.checkProviderHealth(chainId, config.primary);
    }
  }

  /**
   * Check health of a single provider
   */
  private async checkProviderHealth(chainId: number, provider: JsonRpcProvider) {
    const startTime = Date.now();

    try {
      // Simple health check: get block number
      await provider.getBlockNumber();

      const latency = Date.now() - startTime;
      const healthy = latency < this.LATENCY_THRESHOLD_MS;

      this.healthStatus.set(chainId, { healthy, latency });

      // Record latency metric
      const histogram = this.latencyMetrics.get(chainId);
      if (histogram) {
        histogram.observe(latency);
      }

      if (!healthy) {
        this.logger.warn(`RPC provider for chain ${chainId} latency exceeded threshold: ${latency}ms`);
      }
    } catch (error) {
      const latency = Date.now() - startTime;
      this.healthStatus.set(chainId, { healthy: false, latency, error: String(error) });

      // Record failure metric
      const counter = this.failureMetrics.get(chainId);
      if (counter) {
        counter.inc();
      }

      this.logger.error(`RPC provider for chain ${chainId} health check failed:`, error);
    }
  }

  /**
   * Initialize metrics for a specific chain
   */
  private initializeChainMetrics(chainId: number) {
    // Use shared metrics with chain_id label differentiation
    if (this.sharedLatencyHistogram) {
      this.latencyMetrics.set(chainId, this.sharedLatencyHistogram);
    }
    if (this.sharedFailureCounter) {
      this.failureMetrics.set(chainId, this.sharedFailureCounter);
    }
  }

  /**
   * Initialize shared metrics (once)
   */
  private initializeMetrics() {
    const registry = getArbibotMetricsRegistry();

    try {
      this.sharedLatencyHistogram = new Histogram({
        name: 'arb_rpc_latency_seconds',
        help: 'RPC call latency in seconds',
        labelNames: ['chain_id'],
        registers: [registry],
        buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      });
    } catch {
      // Metric already registered (can happen in tests with shared registry)
    }

    try {
      this.sharedFailureCounter = new Counter({
        name: 'arb_rpc_failures_total',
        help: 'Total RPC call failures',
        labelNames: ['chain_id'],
        registers: [registry],
      });
    } catch {
      // Metric already registered
    }

    this.logger.debug('Metrics initialized');
  }
}