import { MismatchesController } from './mismatches.controller';
import { MismatchesService } from './mismatches.service';

/**
 * MismatchesController spec (Phase 4 — reconciliation mismatches API coverage).
 *
 * Controller maps service rows to ISO-date row views and delegates status
 * updates. Service is stubbed; ISO conversion in rowView is the only real
 * transform worth asserting.
 */
describe('MismatchesController', () => {
  let service: {
    list: jest.Mock;
    runDetectors: jest.Mock;
    updateStatus: jest.Mock;
  };
  let controller: MismatchesController;

  beforeEach(() => {
    service = {
      list: jest.fn(),
      runDetectors: jest.fn(),
      updateStatus: jest.fn(),
    };
    controller = new MismatchesController(
      service as unknown as MismatchesService,
    );
  });

  describe('list', () => {
    it('maps each row to an ISO-date row view', async () => {
      const created = new Date('2026-07-17T10:00:00Z');
      const updated = new Date('2026-07-17T11:30:00Z');
      service.list.mockResolvedValue([
        {
          id: 'm-1',
          kind: 'execution-vs-settlement',
          status: 'open',
          details: { expected: 1, actual: 2 },
          entityVersion: 1,
          createdAt: created,
          updatedAt: updated,
        },
      ]);

      const result = await controller.list();

      expect(result.items).toEqual([
        {
          id: 'm-1',
          kind: 'execution-vs-settlement',
          status: 'open',
          details: { expected: 1, actual: 2 },
          entityVersion: 1,
          createdAt: created.toISOString(),
          updatedAt: updated.toISOString(),
        },
      ]);
    });

    it('returns an empty items array when the service returns none', async () => {
      service.list.mockResolvedValue([]);

      const result = await controller.list();

      expect(result).toEqual({ items: [] });
    });
  });

  describe('runDetectors', () => {
    it('delegates to service.runDetectors and returns its result', async () => {
      const detectorResult = { appended: 3, kinds: ['execution-vs-settlement'] };
      service.runDetectors.mockResolvedValue(detectorResult);

      const result = await controller.runDetectors();

      expect(result).toBe(detectorResult);
      expect(service.runDetectors).toHaveBeenCalledTimes(1);
    });
  });

  describe('patchStatus', () => {
    it('updates status and returns the row as an ISO-date row view', async () => {
      const created = new Date('2026-07-17T09:00:00Z');
      const updated = new Date('2026-07-17T12:00:00Z');
      service.updateStatus.mockResolvedValue({
        id: 'm-2',
        kind: 'capital-vs-execution',
        status: 'resolved',
        details: { delta: 5 },
        entityVersion: 2,
        createdAt: created,
        updatedAt: updated,
      });

      const result = await controller.patchStatus(
        '11111111-1111-4111-8111-111111111111',
        { status: 'resolved', expectedEntityVersion: 1 },
      );

      expect(result).toEqual({
        id: 'm-2',
        kind: 'capital-vs-execution',
        status: 'resolved',
        details: { delta: 5 },
        entityVersion: 2,
        createdAt: created.toISOString(),
        updatedAt: updated.toISOString(),
      });
      expect(service.updateStatus).toHaveBeenCalledWith(
        '11111111-1111-4111-8111-111111111111',
        { status: 'resolved', expectedEntityVersion: 1 },
      );
    });
  });
});
