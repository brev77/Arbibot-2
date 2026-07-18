import { DexHealthController } from './dex-health.controller';
import { DexHealthService } from './dex-health.service';

/**
 * DexHealthController spec (Phase 4 — controller coverage).
 *
 * Two GET handlers that delegate to DexHealthService: /health/dex returns
 * composite DEX health (RPC, vault, wallet, mempool); /health/bridges returns
 * bridge health. Pure delegation — assert forwarding + verbatim return.
 */
describe('DexHealthController', () => {
  let dexHealth: { getDexHealth: jest.Mock; getBridgeHealth: jest.Mock };
  let controller: DexHealthController;

  beforeEach(() => {
    dexHealth = {
      getDexHealth: jest.fn(),
      getBridgeHealth: jest.fn(),
    };
    controller = new DexHealthController(
      dexHealth as unknown as DexHealthService,
    );
  });

  it('getDexHealth delegates to DexHealthService.getDexHealth', () => {
    const payload = { status: 'healthy', chains: {} };
    dexHealth.getDexHealth.mockReturnValue(payload);
    expect(controller.getDexHealth()).toBe(payload);
    expect(dexHealth.getDexHealth).toHaveBeenCalledTimes(1);
  });

  it('getBridgeHealth delegates to DexHealthService.getBridgeHealth', () => {
    const payload = { status: 'healthy', bridges: [] };
    dexHealth.getBridgeHealth.mockReturnValue(payload);
    expect(controller.getBridgeHealth()).toBe(payload);
    expect(dexHealth.getBridgeHealth).toHaveBeenCalledTimes(1);
  });
});
