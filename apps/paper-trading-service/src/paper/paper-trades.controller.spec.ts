import { NotFoundException } from '@nestjs/common';

import { PaperTradesController } from './paper-trades.controller';
import { PaperTradesService } from './paper-trades.service';
import type { PaperTradeEntity } from '@arbibot/persistence';

/**
 * PaperTradesController spec (Phase 4 — paper HTTP API coverage).
 *
 * The controller maps service rows to ISO-date DTOs (tradeView) and extracts
 * the operator id from the x-operator-id header for state transitions.
 */
describe('PaperTradesController', () => {
  let service: {
    list: jest.Mock;
    create: jest.Mock;
    getById: jest.Mock;
    patch: jest.Mock;
    approve: jest.Mock;
    reject: jest.Mock;
    cancel: jest.Mock;
  };
  let controller: PaperTradesController;

  const UUID = '11111111-1111-4111-8111-111111111111';
  const createdAt = new Date('2026-07-17T10:00:00Z');
  const updatedAt = new Date('2026-07-17T11:00:00Z');

  const mkRow = (
    over: Partial<PaperTradeEntity> = {},
  ): PaperTradeEntity => ({
    id: UUID,
    opportunityId: null,
    instrumentKey: 'BTC-USDT',
    routeKey: null,
    state: 'draft',
    notional: '0',
    summary: {},
    entityVersion: 1,
    idempotencyKey: null,
    createdAt,
    updatedAt,
    ...over,
  });

  /** Expected tradeView output for a row (ISO-dated). */
  const view = (over: Record<string, unknown> = {}) => ({
    id: UUID,
    opportunityId: null,
    instrumentKey: 'BTC-USDT',
    routeKey: null,
    state: 'draft',
    notional: '0',
    summary: {},
    entityVersion: 1,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    ...over,
  });

  beforeEach(() => {
    service = {
      list: jest.fn(),
      create: jest.fn(),
      getById: jest.fn(),
      patch: jest.fn(),
      approve: jest.fn(),
      reject: jest.fn(),
      cancel: jest.fn(),
    };
    controller = new PaperTradesController(
      service as unknown as PaperTradesService,
    );
  });

  describe('list', () => {
    it('maps each row to an ISO-date tradeView', async () => {
      service.list.mockResolvedValue([mkRow(), mkRow({ id: '22222222-2222-4222-8222-222222222222' })]);

      const result = await controller.list();

      expect(service.list).toHaveBeenCalledTimes(1);
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toEqual(view());
      expect(result.items[0]!.createdAt).toBe(createdAt.toISOString());
    });

    it('returns an empty items array when no trades exist', async () => {
      service.list.mockResolvedValue([]);

      const result = await controller.list();

      expect(result).toEqual({ items: [] });
    });
  });

  describe('create', () => {
    it('creates a trade and returns its ISO-date tradeView', async () => {
      service.create.mockResolvedValue(mkRow({ state: 'draft' }));

      const result = await controller.create({
        instrumentKey: 'BTC-USDT',
      });

      expect(result).toEqual(view());
    });
  });

  describe('getOne', () => {
    it('returns the trade as an ISO-date tradeView', async () => {
      service.getById.mockResolvedValue(mkRow());

      const result = await controller.getOne(UUID);

      expect(result).toEqual(view());
    });

    it('throws NotFoundException when the service returns null', async () => {
      service.getById.mockResolvedValue(null);

      await expect(controller.getOne(UUID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('patch', () => {
    it('patches the trade and returns the updated tradeView', async () => {
      service.patch.mockResolvedValue(mkRow({ state: 'active', entityVersion: 2 }));

      const result = await controller.patch(UUID, { state: 'active', expectedVersion: 1 });

      expect(service.patch).toHaveBeenCalledWith(UUID, {
        state: 'active',
        expectedVersion: 1,
      });
      expect(result).toEqual(view({ state: 'active', entityVersion: 2 }));
    });
  });

  describe('approve / reject / cancel', () => {
    it('approve forwards x-operator-id header to the service', async () => {
      service.approve.mockResolvedValue(mkRow({ state: 'active' }));

      await controller.approve(UUID, {
        headers: { 'x-operator-id': 'op-1' },
      } as never);

      expect(service.approve).toHaveBeenCalledWith(UUID, 'op-1');
    });

    it('approve defaults operator id to "unknown" when the header is missing', async () => {
      service.approve.mockResolvedValue(mkRow());

      await controller.approve(UUID, { headers: {} } as never);

      expect(service.approve).toHaveBeenCalledWith(UUID, 'unknown');
    });

    it('reject forwards x-operator-id header to the service', async () => {
      service.reject.mockResolvedValue(mkRow({ state: 'settled' }));

      await controller.reject(UUID, {
        headers: { 'x-operator-id': 'op-2' },
      } as never);

      expect(service.reject).toHaveBeenCalledWith(UUID, 'op-2');
    });

    it('cancel forwards x-operator-id header to the service', async () => {
      service.cancel.mockResolvedValue(mkRow({ state: 'canceled' }));

      await controller.cancel(UUID, {
        headers: { 'x-operator-id': 'op-3' },
      } as never);

      expect(service.cancel).toHaveBeenCalledWith(UUID, 'op-3');
    });
  });
});
