import { PaperDiscoveryController } from './paper-discovery.controller';
import { PaperDiscoveryService } from './paper-discovery.service';
import { PaperDiscoveryWorker } from './paper-discovery-worker';

/**
 * PaperDiscoveryController spec (Phase 4 — P3-4 discovery API coverage).
 *
 * list() clamps the limit to [1, 500]; rejectCandidate resolves the operator
 * id from query > env > 'system'.
 */
describe('PaperDiscoveryController', () => {
  const originalEnv = process.env;
  let discoveryService: {
    list: jest.Mock;
    getConfig: jest.Mock;
    rejectCandidate: jest.Mock;
  };
  let worker: { triggerDiscovery: jest.Mock; getStatus: jest.Mock };
  let controller: PaperDiscoveryController;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ARBIBOT_DEV_OPERATOR_ID;
    discoveryService = {
      list: jest.fn(),
      getConfig: jest.fn(),
      rejectCandidate: jest.fn(),
    };
    worker = { triggerDiscovery: jest.fn(), getStatus: jest.fn() };
    controller = new PaperDiscoveryController(
      discoveryService as unknown as PaperDiscoveryService,
      worker as unknown as PaperDiscoveryWorker,
    );
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('list', () => {
    it('defaults limit to 100 when omitted', async () => {
      discoveryService.list.mockResolvedValue({ items: [] });

      await controller.list(undefined, undefined);

      expect(discoveryService.list).toHaveBeenCalledWith(undefined, 100);
    });

    it('clamps limit to [1, 500]', async () => {
      discoveryService.list.mockResolvedValue({ items: [] });

      await controller.list(undefined, '9999');
      expect(discoveryService.list).toHaveBeenLastCalledWith(undefined, 500);

      await controller.list(undefined, '0');
      expect(discoveryService.list).toHaveBeenLastCalledWith(undefined, 1);
    });

    it('forwards the status filter', async () => {
      discoveryService.list.mockResolvedValue({ items: [] });

      await controller.list('discovered', '50');

      expect(discoveryService.list).toHaveBeenCalledWith('discovered', 50);
    });
  });

  describe('trigger / status / config', () => {
    it('trigger delegates to the worker', async () => {
      worker.triggerDiscovery.mockResolvedValue({ success: true });

      const result = await controller.trigger();

      expect(result).toEqual({ success: true });
    });

    it('status returns the worker status snapshot', () => {
      worker.getStatus.mockReturnValue({ isRunning: false });

      const result = controller.getStatus();

      expect(result).toEqual({ isRunning: false });
    });

    it('config returns the discovery config', () => {
      const cfg = { minProfitUsd: 5 };
      discoveryService.getConfig.mockReturnValue(cfg);

      const result = controller.getConfig();

      expect(result).toBe(cfg);
    });
  });

  describe('rejectCandidate', () => {
    it('uses the operatorId query when present', async () => {
      discoveryService.rejectCandidate.mockResolvedValue({ id: 'c-1', status: 'rejected' });

      await controller.rejectCandidate('c-1', 'op-1');

      expect(discoveryService.rejectCandidate).toHaveBeenCalledWith('c-1', 'op-1');
    });

    it('falls back to ARBIBOT_DEV_OPERATOR_ID env when query is absent', async () => {
      process.env.ARBIBOT_DEV_OPERATOR_ID = 'op-env';
      discoveryService.rejectCandidate.mockResolvedValue({ id: 'c-2' });

      await controller.rejectCandidate('c-2', undefined);

      expect(discoveryService.rejectCandidate).toHaveBeenCalledWith('c-2', 'op-env');
    });

    it('falls back to "system" when neither query nor env is set', async () => {
      discoveryService.rejectCandidate.mockResolvedValue({ id: 'c-3' });

      await controller.rejectCandidate('c-3', undefined);

      expect(discoveryService.rejectCandidate).toHaveBeenCalledWith('c-3', 'system');
    });

    it('treats an empty operatorId query as absent (env/system fallback)', async () => {
      process.env.ARBIBOT_DEV_OPERATOR_ID = 'op-env';
      discoveryService.rejectCandidate.mockResolvedValue({ id: 'c-4' });

      await controller.rejectCandidate('c-4', '');

      expect(discoveryService.rejectCandidate).toHaveBeenCalledWith('c-4', 'op-env');
    });
  });
});
