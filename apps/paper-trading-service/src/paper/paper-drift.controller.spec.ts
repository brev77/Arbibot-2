import { PaperDriftController } from './paper-drift.controller';
import { PaperDriftService } from './paper-drift.service';
import { PaperDriftWorker } from './paper-drift-worker';

/** PaperDriftController spec (Phase 4 — drift-samples API coverage). */
describe('PaperDriftController', () => {
  let service: { list: jest.Mock; record: jest.Mock };
  let worker: { trigger: jest.Mock };
  let controller: PaperDriftController;

  const capturedAt = new Date('2026-07-17T10:00:00Z');

  const mkRow = () => ({
    id: 'd-1',
    instrumentKey: 'BTC-USDT',
    paperMid: '50000',
    referenceMid: '50010',
    driftBps: '2',
    capturedAt,
  });

  beforeEach(() => {
    service = { list: jest.fn(), record: jest.fn() };
    worker = { trigger: jest.fn() };
    controller = new PaperDriftController(
      service as unknown as PaperDriftService,
      worker as unknown as PaperDriftWorker,
    );
  });

  describe('list', () => {
    it('maps rows to ISO-date driftView, defaults limit to 50', async () => {
      service.list.mockResolvedValue([mkRow()]);

      const result = await controller.list(undefined, undefined);

      expect(service.list).toHaveBeenCalledWith(undefined, 50);
      expect(result.items).toEqual([
        {
          id: 'd-1',
          instrumentKey: 'BTC-USDT',
          paperMid: '50000',
          referenceMid: '50010',
          driftBps: '2',
          capturedAt: capturedAt.toISOString(),
        },
      ]);
    });

    it('forwards the instrumentKey filter + parsed numeric limit', async () => {
      service.list.mockResolvedValue([]);

      await controller.list('ETH-USDT', '25');

      expect(service.list).toHaveBeenCalledWith('ETH-USDT', 25);
    });

    it('falls back to limit 50 when the query is non-numeric', async () => {
      service.list.mockResolvedValue([]);

      await controller.list(undefined, 'abc');

      expect(service.list).toHaveBeenCalledWith(undefined, 50);
    });
  });

  describe('create', () => {
    it('records a drift sample and returns its ISO-date driftView', async () => {
      service.record.mockResolvedValue(mkRow());

      const result = await controller.create({} as never);

      expect(result.capturedAt).toBe(capturedAt.toISOString());
    });
  });

  describe('refreshStale', () => {
    it('triggers the drift worker self-heal cycle and returns its result', async () => {
      worker.trigger.mockResolvedValue({ reset: 3 });

      const result = await controller.refreshStale();

      expect(worker.trigger).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ reset: 3 });
    });
  });
});
