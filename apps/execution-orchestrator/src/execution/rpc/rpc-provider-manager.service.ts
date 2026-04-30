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
    }
    this.providers.clear();
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
      { chainId: 421611, primary: process.env.RPC_ARBITRUM_TESTNET_URL, backup: process.env.RPC_ARBITRUM_TESTNET_BACKUP_URL },
      { chainId: 8453, primary: process.env.RPC_BASE_MAINNET_URL, backup: process.env.RPC_BASE_MAINNET_BACKUP_URL },
      { chainId: 84531, primary: process.env.RPC_BASE_TESTNET_URL, backup: process.env.RPC_BASE_TESTNET_BACKUP_URL },
      { chainId: 56, primary: process.env.RPC_BNB_MAINNET_URL, backup: process.env.RPC_BNB_MAINNET_BACKUP_URL },
      { chainId: 97, primary: process.env.RPC_BNB_TESTNET_URL, backup: process.env.RPC_BNB_TESTNET_BACKUP_URL },
    ];

    for (const config of configs) {
      if (!config.primary) {
        this.logger.warn(`No RPC URL configured for chain ${config.chainId}, skipping`);
        continue;
      }

      try {
        const primary = new JsonRpcProvider(config.primary, config.chainId);
        let backup: JsonRpcProvider | undefined;
        let combined: FallbackProvider | undefined;

        if (config.backup) {
          backup = new JsonRpcProvider(config.backup, config.chainId);
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
    const registry = getArbibotMetricsRegistry();

    // Latency histogram
    const latencyHistogram = new Histogram({
      name: 'arb_rpc_latency_seconds',
      help: 'RPC call latency in seconds',
      labelNames: ['chain_id'],
      registers: [registry],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    });
    this.latencyMetrics.set(chainId, latencyHistogram);

    // Failure counter
    const failureCounter = new Counter({
      name: 'arb_rpc_failures_total',
      help: 'Total RPC call failures',
      labelNames: ['chain_id'],
      registers: [registry],
    });
    this.failureMetrics.set(chainId, failureCounter);
  }

  /**
   * Initialize all metrics
   */
  private initializeMetrics() {
    // Metrics are initialized per chain in initializeChainMetrics
    this.logger.debug('Metrics initialized');
  }
}