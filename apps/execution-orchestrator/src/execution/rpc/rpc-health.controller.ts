import { Controller, Get } from '@nestjs/common';
import { RpcProviderManager } from './rpc-provider-manager.service';

/**
 * RPC Health Controller
 * Exposes RPC provider health status for monitoring
 */
@Controller('health')
export class RpcHealthController {
  constructor(private readonly rpcProviderManager: RpcProviderManager) {}

  @Get('rpc')
  getRpcHealth() {
    const allStatus = this.rpcProviderManager.getAllHealthStatus();
    const chains: Record<number, { healthy: boolean; latency: number; error?: string }> = {};

    let allHealthy = true;
    for (const [chainId, status] of allStatus) {
      chains[chainId] = status;
      if (!status.healthy) {
        allHealthy = false;
      }
    }

    return {
      status: allHealthy ? 'healthy' : 'degraded',
      chains,
      totalChains: allStatus.size,
      healthyChains: Array.from(allStatus.values()).filter((s) => s.healthy).length,
      timestamp: new Date().toISOString(),
    };
  }
}