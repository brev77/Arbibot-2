 
import type { PortfolioPositionEntity } from '@arbibot/persistence';

import type { ClosePositionDto } from './dto/close-position.dto';
import type { ConfirmFillDto } from './dto/confirm-fill.dto';
import { PositionsController } from './positions.controller';
import type { PositionsService } from './positions.service';

/**
 * PositionsController spec.
 *
 * Pattern: direct instantiation with a stub PositionsService. The controller
 * is a thin adapter over the service — exercises rowView mapping, HttpCode
 * metadata, and delegates parameters verbatim.
 */
describe('PositionsController', () => {
  let service: { list: jest.Mock; confirmFill: jest.Mock; close: jest.Mock };
  let controller: PositionsController;

  function mkPosition(
    over: Partial<PortfolioPositionEntity> = {},
  ): PortfolioPositionEntity {
    return {
      id: '11111111-1111-4111-8111-111111111111',
      planId: 'plan-1',
      instrumentKey: 'USDC-WETH',
      quantity: '100',
      notionalUsd: '2500',
      entityVersion: 3,
      createdAt: new Date('2026-07-17T12:00:00Z'),
      updatedAt: new Date('2026-07-17T12:30:00Z'),
      ...over,
    };
  }

  beforeEach(() => {
    service = {
      list: jest.fn(),
      confirmFill: jest.fn().mockResolvedValue(undefined),
      close: jest.fn(),
    };
    controller = new PositionsController(service as unknown as PositionsService);
  });

  describe('list', () => {
    it('maps rows to ISO-date DTOs', async () => {
      service.list.mockResolvedValue([mkPosition()]);

      const result = await controller.list();

      expect(result).toEqual({
        items: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            planId: 'plan-1',
            instrumentKey: 'USDC-WETH',
            quantity: '100',
            entityVersion: 3,
            createdAt: '2026-07-17T12:00:00.000Z',
            updatedAt: '2026-07-17T12:30:00.000Z',
          },
        ],
      });
      expect(service.list).toHaveBeenCalled();
    });

    it('returns empty items array when service returns no rows', async () => {
      service.list.mockResolvedValue([]);
      const result = await controller.list();
      expect(result).toEqual({ items: [] });
    });
  });

  describe('confirmFill', () => {
    it('delegates to service and returns void (HttpCode 204)', async () => {
      const body: ConfirmFillDto = {
        planId: 'p-1',
        legId: 'l-1',
        instrumentKey: 'k',
        quantity: '1',
        notionalUsd: '100',
        idempotencyKey: 'idem-1',
      };

      await controller.confirmFill(body);

      expect(service.confirmFill).toHaveBeenCalledWith(body);
    });
  });

  describe('close', () => {
    it('returns rowView after closing (HttpCode 200)', async () => {
      const closed = mkPosition({
        quantity: '0',
        entityVersion: 4,
      });
      service.close.mockResolvedValue(closed);

      const body: ClosePositionDto = {
        operatorId: 'op-1',
        idempotencyKey: 'close-1',
      };
      const result = await controller.close(
        '11111111-1111-4111-8111-111111111111',
        body,
      );

      expect(service.close).toHaveBeenCalledWith(
        '11111111-1111-4111-8111-111111111111',
        body,
      );
      expect(result).toEqual({
        id: '11111111-1111-4111-8111-111111111111',
        planId: 'plan-1',
        instrumentKey: 'USDC-WETH',
        quantity: '0',
        entityVersion: 4,
        createdAt: '2026-07-17T12:00:00.000Z',
        updatedAt: '2026-07-17T12:30:00.000Z',
      });
    });

    it('forwards arbitrary UUID without mutation', async () => {
      const closed = mkPosition({
        id: '22222222-2222-4222-8222-222222222222',
      });
      service.close.mockResolvedValue(closed);

      await controller.close('22222222-2222-4222-8222-222222222222', {
        operatorId: 'op-2',
      });

      expect(service.close).toHaveBeenCalledWith(
        '22222222-2222-4222-8222-222222222222',
        expect.objectContaining({ operatorId: 'op-2' }),
      );
    });
  });
});
