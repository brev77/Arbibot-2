import { RpcHealthController } from './rpc-health.controller';
import { RpcProviderManager } from './rpc-provider-manager.service';

/**
 * RpcHealthController spec (Phase 4 — controller coverage).
 *
 * GET /health/rpc projects the per-chain health map from RpcProviderManager
 * into an aggregate payload: status (healthy/degraded based on whether any
 * chain is unhealthy), the chains map, totalChains, healthyChains, and a
 * timestamp. We assert: all-healthy path, degraded path (one unhealthy),
 * and empty path (no chains registered).
 */
describe('RpcHealthController', () => {
  let rpc: { getAllHealthStatus: jest.Mock };
  let controller: RpcHealthController;

  beforeEach(() => {
    rpc = { getAllHealthStatus: jest.fn() };
    controller = new RpcHealthController(
      rpc as unknown as RpcProviderManager,
    );
  });

  it('reports status=healthy when every chain is healthy', () => {
    rpc.getAllHealthStatus.mockReturnValue(
      new Map([
        [1, { healthy: true, latency: 50 }],
        [137, { healthy: true, latency: 80 }],
      ]),
    );
    const out = controller.getRpcHealth();
    expect(out.status).toBe('healthy');
    expect(out.totalChains).toBe(2);
    expect(out.healthyChains).toBe(2);
    expect(out.chains[1]).toEqual({ healthy: true, latency: 50 });
    expect(out.chains[137]).toEqual({ healthy: true, latency: 80 });
    expect(typeof out.timestamp).toBe('string');
  });

  it('reports status=degraded when any chain is unhealthy', () => {
    rpc.getAllHealthStatus.mockReturnValue(
      new Map([
        [1, { healthy: true, latency: 50 }],
        [137, { healthy: false, latency: 0, error: 'rpc down' }],
      ]),
    );
    const out = controller.getRpcHealth();
    expect(out.status).toBe('degraded');
    expect(out.totalChains).toBe(2);
    expect(out.healthyChains).toBe(1);
    expect(out.chains[137]).toEqual({ healthy: false, latency: 0, error: 'rpc down' });
  });

  it('reports status=healthy with zero chains when the map is empty', () => {
    rpc.getAllHealthStatus.mockReturnValue(new Map());
    const out = controller.getRpcHealth();
    expect(out.status).toBe('healthy');
    expect(out.totalChains).toBe(0);
    expect(out.healthyChains).toBe(0);
    expect(out.chains).toEqual({});
  });
});
