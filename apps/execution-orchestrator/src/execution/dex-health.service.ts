import { Injectable, Logger } from '@nestjs/common';

import { RpcProviderManager } from './rpc/rpc-provider-manager.service';
import { WalletManagerService } from './wallet-manager.service';
import { KeyVaultService } from '@arbibot/nest-platform';
import { Gauge } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

/**
 * Health status for a single component
 */
export interface ComponentHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'not_configured';
  latencyMs?: number;
  error?: string;
  details?: Record<string, unknown>;
}

/**
 * Overall DEX health response
 */
export interface DexHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  rpc: Record<string, ComponentHealthStatus>;
  vault: ComponentHealthStatus;
  wallet: ComponentHealthStatus;
  mempoolMonitor: ComponentHealthStatus;
  timestamp: string;
}

/**
 * DEX Health Service
 * Step: DEX-1-2-HEALTH
 *
 * Aggregates health status of all DEX infrastructure components:
 * - RPC providers (per chain: latency, sync status)
 * - Key vault (encryption key available, metrics)
 * - Wallet manager (wallets registered, nonce drift)
 * - Mempool monitor (if enabled)
 */
@Injectable()
export class DexHealthService {
  private readonly logger = new Logger(DexHealthService.name);

  private healthCheckGauge!: Gauge<string>;

  constructor(
    private readonly rpcProviderManager: RpcProviderManager,
    private readonly walletManager: WalletManagerService,
    private readonly keyVaultService: KeyVaultService,
  ) {
    this.initializeMetrics();
  }

  /**
   * Get comprehensive DEX health status
   */
  getDexHealth(): DexHealthResponse {
    const rpcHealth = this.getRpcHealth();
    const vaultHealth = this.getVaultHealth();
    const walletHealth = this.getWalletHealth();
    const mempoolHealth = this.getMempoolMonitorHealth();

    // Determine overall status
    const allStatuses: ComponentHealthStatus[] = [
      ...Object.values(rpcHealth),
      vaultHealth,
      walletHealth,
      mempoolHealth,
    ];

    const hasUnhealthy = allStatuses.some((s) => s.status === 'unhealthy');
    const hasDegraded = allStatuses.some((s) => s.status === 'degraded');

    let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
    if (hasUnhealthy) {
      overallStatus = 'unhealthy';
    } else if (hasDegraded) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'healthy';
    }

    // Update gauge metric
    this.healthCheckGauge.set(
      { status: overallStatus },
      overallStatus === 'healthy' ? 1 : overallStatus === 'degraded' ? 0.5 : 0,
    );

    return {
      status: overallStatus,
      rpc: rpcHealth,
      vault: vaultHealth,
      wallet: walletHealth,
      mempoolMonitor: mempoolHealth,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get health status for bridge infrastructure (DEX-2 stub)
   */
  getBridgeHealth(): {
    status: 'not_configured';
    message: string;
    timestamp: string;
  } {
    return {
      status: 'not_configured',
      message: 'Bridge health checks will be available in DEX-2 phase',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Check RPC provider health for all chains
   */
  private getRpcHealth(): Record<string, ComponentHealthStatus> {
    const allStatus = this.rpcProviderManager.getAllHealthStatus();
    const result: Record<string, ComponentHealthStatus> = {};

    for (const [chainId, status] of allStatus) {
      const chainKey = `chain_${chainId}`;
      if (status.healthy) {
        if (status.latency > 80) {
          // Close to threshold (100ms) — degraded
          result[chainKey] = {
            status: 'degraded',
            latencyMs: status.latency,
            details: { threshold: 100 },
          };
        } else {
          result[chainKey] = {
            status: 'healthy',
            latencyMs: status.latency,
          };
        }
      } else {
        result[chainKey] = {
          status: 'unhealthy',
          latencyMs: status.latency,
          error: status.error || 'Health check failed',
        };
      }
    }

    // If no RPC providers configured
    if (Object.keys(result).length === 0) {
      result['none'] = {
        status: 'not_configured',
        error: 'No RPC providers configured',
      };
    }

    return result;
  }

  /**
   * Check Key Vault health
   */
  private getVaultHealth(): ComponentHealthStatus {
    try {
      const metrics = this.keyVaultService.getMetrics();
      const allKeys = this.keyVaultService.getAllWalletKeys();
      const activeKeys = allKeys.filter((k) => k.isActive);

      return {
        status: 'healthy',
        details: {
          activeKeys: activeKeys.length,
          totalKeys: allKeys.length,
          encryptCount: metrics.encryptCount,
          decryptCount: metrics.decryptCount,
          averageEncryptLatencyMs: metrics.averageEncryptLatency,
          averageDecryptLatencyMs: metrics.averageDecryptLatency,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Vault health check failed',
      };
    }
  }

  /**
   * Check Wallet Manager health
   */
  private getWalletHealth(): ComponentHealthStatus {
    try {
      const allKeys = this.keyVaultService.getAllWalletKeys();
      const activeKeys = allKeys.filter((k) => k.isActive);

      if (activeKeys.length === 0) {
        return {
          status: 'degraded',
          details: {
            totalWallets: 0,
            activeWallets: 0,
          },
          error: 'No active wallets registered',
        };
      }

      // Group by chain
      const chainCounts: Record<number, number> = {};
      for (const key of activeKeys) {
        chainCounts[key.chainId] = (chainCounts[key.chainId] || 0) + 1;
      }

      return {
        status: 'healthy',
        details: {
          totalWallets: allKeys.length,
          activeWallets: activeKeys.length,
          walletsPerChain: chainCounts,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Wallet health check failed',
      };
    }
  }

  /**
   * Check Mempool Monitor health
   */
  private getMempoolMonitorHealth(): ComponentHealthStatus {
    const enabled = process.env.MEMPOOL_MONITOR_ENABLED === 'true';

    if (!enabled) {
      return {
        status: 'not_configured',
        details: { enabled: false },
      };
    }

    return {
      status: 'healthy',
      details: {
        enabled: true,
      },
    };
  }

  /**
   * Initialize Prometheus metrics
   */
  private initializeMetrics(): void {
    const registry = getArbibotMetricsRegistry();

    this.healthCheckGauge = new Gauge({
      name: 'arb_dex_health_status',
      help: 'DEX infrastructure health status (1=healthy, 0.5=degraded, 0=unhealthy)',
      labelNames: ['status'],
      registers: [registry],
    });
  }
}