import { HealthController } from './health.controller';
import type { ScannerRpcService } from '../scanner/scanner-rpc.service';

/**
 * HealthController spec — covers the only service-specific probe `GET /health/rpc`,
 * which delegates verbatim to `ScannerRpcService.getAllHealthStatus()`.
 *
 * The base `/health`, `/health/live`, `/health/ready` routes are owned by the shared
 * HealthModule from @arbibot/nest-platform and are out of scope here.
 */
describe('HealthController', () => {
  let rpc: { getAllHealthStatus: jest.Mock };
  let controller: HealthController;

  beforeEach(() => {
    rpc = { getAllHealthStatus: jest.fn() };
    controller = new HealthController(rpc as unknown as ScannerRpcService);
  });

  it('rpcStatus returns the per-chain RPC health snapshot verbatim', () => {
    const snapshot = [
      {
        chainId: 42161,
        url: 'http://arb.example',
        healthy: true,
        latencyMs: 120,
        blockNumber: 123456,
        tokensHealth: 10,
      },
      {
        chainId: 8453,
        url: 'http://base.example',
        healthy: false,
        latencyMs: null,
        blockNumber: null,
        tokensHealth: 0,
        error: 'connection refused',
      },
    ];
    rpc.getAllHealthStatus.mockReturnValue(snapshot);

    const out = controller.rpcStatus();

    expect(out).toBe(snapshot);
    expect(rpc.getAllHealthStatus).toHaveBeenCalledTimes(1);
  });

  it('rpcStatus returns an empty array when no chains are configured', () => {
    rpc.getAllHealthStatus.mockReturnValue([]);
    expect(controller.rpcStatus()).toEqual([]);
  });
});
