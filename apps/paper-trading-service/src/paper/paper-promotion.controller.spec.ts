import { PaperPromotionController } from './paper-promotion.controller';
import { PaperPromotionService } from './paper-promotion.service';
import type { PaperPromotionCandidateEntity } from '@arbibot/persistence';

/**
 * PaperPromotionController spec (Phase 4 — paper promotion API coverage).
 *
 * promoView derives qualityTier/qualityScore: stored values take precedence,
 * falling back to promotionQualityFor(row) when unset. The controller also
 * extracts operator id from x-operator-id for state transitions.
 */
describe('PaperPromotionController', () => {
  let service: {
    list: jest.Mock;
    create: jest.Mock;
    patch: jest.Mock;
    approve: jest.Mock;
    reject: jest.Mock;
    getPromotionCriteria: jest.Mock;
  };
  let controller: PaperPromotionController;

  const UUID = '11111111-1111-4111-8111-111111111111';
  const createdAt = new Date('2026-07-17T10:00:00Z');
  const updatedAt = new Date('2026-07-17T11:00:00Z');

  const mkRow = (
    over: Partial<PaperPromotionCandidateEntity> = {},
  ): PaperPromotionCandidateEntity => ({
    id: UUID,
    instrumentKey: 'BTC-USDT',
    opportunityId: null,
    source: 'discovery',
    status: 'queued',
    score: '6',
    driftBps: '0',
    evidence: {},
    enqueueIdempotencyKey: null,
    entityVersion: 1,
    qualityTier: null,
    qualityScore: null,
    createdAt,
    updatedAt,
    ...over,
  });

  beforeEach(() => {
    service = {
      list: jest.fn(),
      create: jest.fn(),
      patch: jest.fn(),
      approve: jest.fn(),
      reject: jest.fn(),
      getPromotionCriteria: jest.fn(),
    };
    controller = new PaperPromotionController(
      service as unknown as PaperPromotionService,
    );
  });

  describe('list', () => {
    it('maps rows to promoView with derived quality tier/score (no stored values)', async () => {
      // score=6, driftBps=0 -> derived score = 6+2-0 = 8 -> tier high.
      service.list.mockResolvedValue([mkRow()]);

      const result = await controller.list();

      expect(result.items[0]).toMatchObject({
        qualityTier: 'high',
        qualityScore: 8,
        createdAt: createdAt.toISOString(),
      });
    });

    it('uses stored qualityTier when present (skips derivation)', async () => {
      service.list.mockResolvedValue([
        mkRow({ qualityTier: 'low', qualityScore: '3.2' }),
      ]);

      const result = await controller.list();

      // Stored tier 'low' wins over derived 'high'.
      expect(result.items[0]!.qualityTier).toBe('low');
      // Stored score is rounded to 3 decimals: 3.2 -> 3.2.
      expect(result.items[0]!.qualityScore).toBe(3.2);
    });

    it('forwards the status query filter to the service', async () => {
      service.list.mockResolvedValue([]);

      await controller.list('pending');

      expect(service.list).toHaveBeenCalledWith('pending');
    });
  });

  describe('create / patch', () => {
    it('create returns the candidate as a promoView', async () => {
      service.create.mockResolvedValue(mkRow());

      const result = await controller.create({
        instrumentKey: 'BTC-USDT',
      });

      expect(result.id).toBe(UUID);
      expect(result.qualityTier).toBe('high');
    });

    it('patch forwards id + body and returns the updated promoView', async () => {
      service.patch.mockResolvedValue(mkRow({ status: 'promoted', entityVersion: 2 }));

      const result = await controller.patch(UUID, { status: 'promoted', expectedVersion: 1 });

      expect(service.patch).toHaveBeenCalledWith(UUID, { status: 'promoted', expectedVersion: 1 });
      expect(result.status).toBe('promoted');
    });
  });

  describe('approve / reject (operator id from header)', () => {
    it('approve forwards x-operator-id to the service', async () => {
      service.approve.mockResolvedValue(mkRow({ status: 'promoted' }));

      await controller.approve(UUID, {
        headers: { 'x-operator-id': 'op-1' },
      } as never);

      expect(service.approve).toHaveBeenCalledWith(UUID, 'op-1');
    });

    it('approve defaults operator id to "unknown" when the header is absent', async () => {
      service.approve.mockResolvedValue(mkRow());

      await controller.approve(UUID, { headers: {} } as never);

      expect(service.approve).toHaveBeenCalledWith(UUID, 'unknown');
    });

    it('reject forwards x-operator-id to the service', async () => {
      service.reject.mockResolvedValue(mkRow({ status: 'rejected' }));

      await controller.reject(UUID, {
        headers: { 'x-operator-id': 'op-9' },
      } as never);

      expect(service.reject).toHaveBeenCalledWith(UUID, 'op-9');
    });
  });
});
