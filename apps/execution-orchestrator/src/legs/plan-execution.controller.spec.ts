import { HttpStatus } from '@nestjs/common';

import { PlanExecutionController } from './plan-execution.controller';
import { LegsService } from './legs.service';

/**
 * PlanExecutionController spec (Phase 4 — controller coverage).
 *
 * The controller is a thin HTTP adapter: a single POST handler that validates
 * the planId via ParseUUIDPipe and delegates to LegsService.beginExecution.
 * @HttpCode(200) is the only decorator-level concern worth asserting.
 */
describe('PlanExecutionController', () => {
  let legs: { beginExecution: jest.Mock };
  let controller: PlanExecutionController;

  beforeEach(() => {
    legs = { beginExecution: jest.fn() };
    controller = new PlanExecutionController(legs as unknown as LegsService);
  });

  it('delegates planId to LegsService.beginExecution', async () => {
    const uuid = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee';
    legs.beginExecution.mockResolvedValue({ id: uuid, state: 'running' });
    const out = await controller.begin(uuid);
    expect(legs.beginExecution).toHaveBeenCalledWith(uuid);
    expect(out).toEqual({ id: uuid, state: 'running' });
  });

  it('forwards the service return value verbatim on undefined result', async () => {
    legs.beginExecution.mockResolvedValue(undefined);
    const out = await controller.begin(
      'bbbbbbbb-bbbb-4ccc-dddd-eeeeeeeeeeee',
    );
    expect(out).toBeUndefined();
  });

  it('HttpCode(200) decorator is applied to the begin handler', () => {
    const meta = Reflect.getMetadata(
      '__httpCode__',
      controller.begin,
    ) as number | undefined;
    expect(meta).toBe(HttpStatus.OK);
  });
});
