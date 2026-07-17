import { HttpStatus } from '@nestjs/common';

import { HermesMutationController } from './hermes-mutation.controller';
import { HermesMutationService } from './hermes-mutation.service';

/**
 * HermesMutationController spec (Phase 4 — mutation endpoints coverage).
 *
 * The controller is a thin HTTP adapter: each handler extracts the id, body,
 * and correlation id, then delegates to HermesMutationService. ParseUUIDPipe +
 * @HttpCode(200) + getCorrelationId are the only controller-level concerns
 * worth asserting; business logic lives in the service (covered by
 * hermes-mutation.service.spec.ts).
 */
describe('HermesMutationController', () => {
  let mutations: {
    armPlan: jest.Mock;
    beginExecution: jest.Mock;
    closePosition: jest.Mock;
    resolveIncident: jest.Mock;
    enableSafeMode: jest.Mock;
    disableSafeMode: jest.Mock;
  };
  let controller: HermesMutationController;

  const UUID = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    mutations = {
      armPlan: jest.fn().mockResolvedValue({ ok: true }),
      beginExecution: jest.fn().mockResolvedValue({ ok: true }),
      closePosition: jest.fn().mockResolvedValue({ ok: true }),
      resolveIncident: jest.fn().mockResolvedValue({ ok: true }),
      enableSafeMode: jest.fn().mockResolvedValue({ ok: true }),
      disableSafeMode: jest.fn().mockResolvedValue({ ok: true }),
    };
    controller = new HermesMutationController(
      mutations as unknown as HermesMutationService,
    );
  });

  it('armPlan delegates id + body + correlation id to the service', async () => {
    const body = { operatorId: 'op-1', reason: 'manual' };
    await controller.armPlan({ correlationId: 'corr-1' }, UUID, body);

    expect(mutations.armPlan).toHaveBeenCalledWith(UUID, body, 'corr-1');
  });

  it('armPlan forwards undefined correlation id when absent', async () => {
    await controller.armPlan({}, UUID, { operatorId: 'op-1' });

    expect(mutations.armPlan).toHaveBeenCalledWith(
      UUID,
      { operatorId: 'op-1' },
      undefined,
    );
  });

  it('executePlan delegates to beginExecution', async () => {
    const body = { operatorId: 'op-1' };
    await controller.executePlan({ correlationId: 'c' }, UUID, body);

    expect(mutations.beginExecution).toHaveBeenCalledWith(UUID, body, 'c');
  });

  it('closePosition delegates to closePosition service method', async () => {
    const body = { operatorId: 'op-1' };
    await controller.closePosition({ correlationId: 'c' }, UUID, body);

    expect(mutations.closePosition).toHaveBeenCalledWith(UUID, body, 'c');
  });

  it('resolveIncident delegates to resolveIncident service method', async () => {
    const body = { operatorId: 'op-1', resolution: 'acknowledged' };
    await controller.resolveIncident({ correlationId: 'c' }, UUID, body);

    expect(mutations.resolveIncident).toHaveBeenCalledWith(UUID, body, 'c');
  });

  it('safeModeEnable delegates to enableSafeMode', async () => {
    const body = { operatorId: 'op-1', reason: 'drill' };
    await controller.safeModeEnable({ correlationId: 'c' }, body);

    expect(mutations.enableSafeMode).toHaveBeenCalledWith(body, 'c');
  });

  it('safeModeDisable delegates to disableSafeMode', async () => {
    const body = { operatorId: 'op-1', confirm: 'I UNDERSTAND' };
    await controller.safeModeDisable({ correlationId: 'c' }, body);

    expect(mutations.disableSafeMode).toHaveBeenCalledWith(body, 'c');
  });

  it('returns the value produced by the service', async () => {
    mutations.armPlan.mockResolvedValue({ status: 'armed', id: UUID });
    const result = await controller.armPlan({}, UUID, { operatorId: 'op-1' });
    expect(result).toEqual({ status: 'armed', id: UUID });
  });

  it('HttpCode(200) decorator is applied to the armPlan handler', () => {
    // Reflect-metadata check: the handler carries a HttpStatus.OK http code.
    const meta = Reflect.getMetadata(
      '__httpCode__',
      controller.armPlan,
    ) as number | undefined;
    expect(meta).toBe(HttpStatus.OK);
  });
});
