import { HttpStatus } from '@nestjs/common';

import { PlanLegActionsController } from './plan-leg-actions.controller';
import { LegsService } from './legs.service';

/**
 * PlanLegActionsController spec (Phase 4 — controller coverage).
 *
 * Three POST handlers (mark-sent, mark-acknowledged, apply-fill), each
 * delegating to LegsService with the validated planId/legId pair.
 * @HttpCode(200) on every handler is the only decorator-level concern.
 */
describe('PlanLegActionsController', () => {
  let legs: {
    markSent: jest.Mock;
    markAcknowledged: jest.Mock;
    applyFill: jest.Mock;
  };
  let controller: PlanLegActionsController;

  const PLAN = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee';
  const LEG = 'bbbbbbbb-bbbb-4ccc-dddd-eeeeeeeeeeee';

  beforeEach(() => {
    legs = {
      markSent: jest.fn(),
      markAcknowledged: jest.fn(),
      applyFill: jest.fn(),
    };
    controller = new PlanLegActionsController(legs as unknown as LegsService);
  });

  it('markSent delegates planId/legId to LegsService.markSent', async () => {
    legs.markSent.mockResolvedValue({ id: LEG, state: 'sent' });
    const out = await controller.markSent(PLAN, LEG);
    expect(legs.markSent).toHaveBeenCalledWith(PLAN, LEG);
    expect(out).toEqual({ id: LEG, state: 'sent' });
  });

  it('markAck delegates planId/legId to LegsService.markAcknowledged', async () => {
    legs.markAcknowledged.mockResolvedValue({ id: LEG, state: 'acknowledged' });
    const out = await controller.markAck(PLAN, LEG);
    expect(legs.markAcknowledged).toHaveBeenCalledWith(PLAN, LEG);
    expect(out).toEqual({ id: LEG, state: 'acknowledged' });
  });

  it('applyFill delegates planId/legId/body to LegsService.applyFill', async () => {
    const body = {
      mode: 'full' as const,
      idempotencyKey: 'cccccccc-cccc-4ccc-dddd-eeeeeeeeeeee',
    };
    legs.applyFill.mockResolvedValue({ id: LEG, state: 'filled' });
    const out = await controller.applyFill(PLAN, LEG, body);
    expect(legs.applyFill).toHaveBeenCalledWith(PLAN, LEG, body);
    expect(out).toEqual({ id: LEG, state: 'filled' });
  });

  it('HttpCode(200) decorator is applied to all handlers', () => {
    expect(
      Reflect.getMetadata('__httpCode__', controller.markSent),
    ).toBe(HttpStatus.OK);
    expect(
      Reflect.getMetadata('__httpCode__', controller.markAck),
    ).toBe(HttpStatus.OK);
    expect(
      Reflect.getMetadata('__httpCode__', controller.applyFill),
    ).toBe(HttpStatus.OK);
  });
});
