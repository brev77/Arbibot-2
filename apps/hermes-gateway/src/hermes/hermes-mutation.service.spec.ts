import { HttpException, HttpStatus } from '@nestjs/common';
import { AuditClientService } from '@arbibot/nest-platform';

import { HermesMutationService } from './hermes-mutation.service';
import { HermesUpstreamService } from './hermes-upstream.service';
import { SafeModeService } from './safe-mode.service';

/**
 * HermesMutationService spec (Phase 4 — mutation service coverage).
 *
 * The service is the boundary between the operator-facing mutation endpoints
 * and the upstream execution / portfolio / reconciliation services. It:
 *   1. Builds the upstream URL (via hermes-env helpers).
 *   2. Calls HermesUpstreamService.{post,patch}Json with the operator
 *      correlation id.
 *   3. Audits the outcome (action suffix switches between _OK and _HTTP_<n>
 *      based on the upstream status).
 *   4. Throws HttpException when upstream returns >=400, remapping 5xx to
 *      BAD_GATEWAY.
 *
 * All collaborators are stubbed. SafeModeService is constructed in memory-only
 * mode (see safe-mode.service.spec.ts) so safe-mode toggles don't require
 * Redis.
 */
describe('HermesMutationService', () => {
  const makeService = (
    upstream: HermesUpstreamService,
    audit?: AuditClientService,
  ) =>
    new HermesMutationService(
      upstream,
      audit ??
        ({
          appendEntry: jest.fn().mockResolvedValue(undefined),
        } as unknown as AuditClientService),
      new SafeModeService(),
    );

  const uuid = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee';

  describe('armPlan', () => {
    it('proxies to execution and audits _OK on success', async () => {
      const appendEntry = jest.fn().mockResolvedValue(undefined);
      const postJson = jest
        .fn()
        .mockResolvedValue({ status: 200, json: { ok: true } });
      const upstream = { postJson } as unknown as HermesUpstreamService;
      const svc = makeService(
        upstream,
        { appendEntry } as unknown as AuditClientService,
      );
      const out = await svc.armPlan(
        uuid,
        { operatorId: 'op-1', approveReason: 'test' },
        'corr-1',
      );
      expect(out).toEqual({ ok: true });
      expect(postJson.mock.calls[0]?.[0]).toEqual(
        expect.stringContaining(`/execution/plans/${uuid}/arm`),
      );
      expect(postJson.mock.calls[0]?.[1]).toBeUndefined();
      expect(postJson.mock.calls[0]?.[2]).toBe('corr-1');
      const auditCall = appendEntry.mock.calls[0]?.[0] as {
        action: string;
        resourceId: string;
      };
      expect(auditCall.action).toBe('HERMES_ARM_PLAN_OK');
      expect(auditCall.resourceId).toBe(uuid);
    });

    it('throws HttpException on upstream 4xx and audits _HTTP_<n>', async () => {
      const appendEntry = jest.fn().mockResolvedValue(undefined);
      const postJson = jest
        .fn()
        .mockResolvedValue({ status: 409, json: { error: 'conflict' } });
      const upstream = { postJson } as unknown as HermesUpstreamService;
      const svc = makeService(
        upstream,
        { appendEntry } as unknown as AuditClientService,
      );
      await expect(
        svc.armPlan(uuid, { operatorId: 'op-1' }, 'c'),
      ).rejects.toMatchObject({ status: 409 });
      const auditCall = appendEntry.mock.calls[0]?.[0] as {
        action: string;
      };
      expect(auditCall.action).toBe('HERMES_ARM_PLAN_HTTP_409');
    });

    it('remaps upstream 5xx to BAD_GATEWAY (502)', async () => {
      const postJson = jest
        .fn()
        .mockResolvedValue({ status: 500, json: 'upstream failed' });
      const upstream = { postJson } as unknown as HermesUpstreamService;
      const svc = makeService(upstream);
      try {
        await svc.armPlan(uuid, { operatorId: 'op-1' });
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(HttpException);
        expect((e as HttpException).getStatus()).toBe(HttpStatus.BAD_GATEWAY);
        // string body is preserved as-is
        expect((e as HttpException).getResponse()).toBe('upstream failed');
      }
    });

    it('preserves array and object exception bodies verbatim', async () => {
      const postJson = jest
        .fn()
        .mockResolvedValue({ status: 400, json: ['err1', 'err2'] });
      const upstream = { postJson } as unknown as HermesUpstreamService;
      const svc = makeService(upstream);
      try {
        await svc.armPlan(uuid, { operatorId: 'op-1' });
        throw new Error('expected throw');
      } catch (e) {
        expect((e as HttpException).getResponse()).toEqual(['err1', 'err2']);
      }
    });

    it('stringifies non-string/non-object exception bodies', async () => {
      const postJson = jest
        .fn()
        .mockResolvedValue({ status: 400, json: 42 });
      const upstream = { postJson } as unknown as HermesUpstreamService;
      const svc = makeService(upstream);
      try {
        await svc.armPlan(uuid, { operatorId: 'op-1' });
        throw new Error('expected throw');
      } catch (e) {
        expect((e as HttpException).getResponse()).toBe('42');
      }
    });
  });

  describe('beginExecution', () => {
    it('POSTs to /begin-execution and audits _OK', async () => {
      const appendEntry = jest.fn().mockResolvedValue(undefined);
      const postJson = jest
        .fn()
        .mockResolvedValue({ status: 200, json: { id: uuid, state: 'running' } });
      const upstream = { postJson } as unknown as HermesUpstreamService;
      const svc = makeService(
        upstream,
        { appendEntry } as unknown as AuditClientService,
      );
      const out = await svc.beginExecution(uuid, { operatorId: 'op-1' }, 'c');
      expect(out).toEqual({ id: uuid, state: 'running' });
      expect(postJson.mock.calls[0]?.[0]).toContain(
        `/execution/plans/${uuid}/begin-execution`,
      );
      expect(
        (appendEntry.mock.calls[0]?.[0] as { action: string }).action,
      ).toBe('HERMES_BEGIN_EXECUTION_OK');
    });

    it('throws HttpException on upstream 4xx', async () => {
      const postJson = jest
        .fn()
        .mockResolvedValue({ status: 422, json: { detail: 'invalid' } });
      const upstream = { postJson } as unknown as HermesUpstreamService;
      const svc = makeService(upstream);
      await expect(
        svc.beginExecution(uuid, { operatorId: 'op-1' }),
      ).rejects.toMatchObject({ status: 422 });
    });
  });

  describe('resolveIncident', () => {
    it('PATCHes reconciliation /mismatches/:id with status=resolved and audits', async () => {
      const appendEntry = jest.fn().mockResolvedValue(undefined);
      const patchJson = jest
        .fn()
        .mockResolvedValue({ status: 200, json: { id: 'mm-1', status: 'resolved' } });
      const upstream = { patchJson } as unknown as HermesUpstreamService;
      const svc = makeService(
        upstream,
        { appendEntry } as unknown as AuditClientService,
      );
      const out = await svc.resolveIncident(
        'mm-1',
        { operatorId: 'op-1' },
        'c',
      );
      expect(out).toEqual({ id: 'mm-1', status: 'resolved' });
      const call = patchJson.mock.calls[0];
      expect(call?.[0]).toContain('/mismatches/mm-1');
      expect(call?.[1]).toEqual({ status: 'resolved' });
      const audit = appendEntry.mock.calls[0]?.[0] as {
        action: string;
        payload: { patchBody: Record<string, unknown> };
      };
      expect(audit.action).toBe('HERMES_RESOLVE_INCIDENT_OK');
      // the audit payload embeds the patchBody
      expect(audit.payload.patchBody).toEqual({ status: 'resolved' });
    });

    it('forwards expectedEntityVersion when provided', async () => {
      const patchJson = jest
        .fn()
        .mockResolvedValue({ status: 200, json: {} });
      const upstream = { patchJson } as unknown as HermesUpstreamService;
      const svc = makeService(upstream);
      await svc.resolveIncident('mm-2', {
        operatorId: 'op-1',
        expectedEntityVersion: 7,
      });
      expect(patchJson.mock.calls[0]?.[1]).toEqual({
        status: 'resolved',
        expectedEntityVersion: 7,
      });
    });

    it('throws HttpException on upstream >=400', async () => {
      const patchJson = jest
        .fn()
        .mockResolvedValue({ status: 404, json: 'not found' });
      const upstream = { patchJson } as unknown as HermesUpstreamService;
      const svc = makeService(upstream);
      await expect(
        svc.resolveIncident('mm-3', { operatorId: 'op-1' }),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('closePosition', () => {
    it('proxies to portfolio /positions/:id/close with operatorId', async () => {
      const appendEntry = jest.fn().mockResolvedValue(undefined);
      const postJson = jest.fn().mockResolvedValue({
        status: 200,
        json: { id: 'pos-1', quantity: '0' },
      });
      const upstream = { postJson } as unknown as HermesUpstreamService;
      const svc = makeService(
        upstream,
        { appendEntry } as unknown as AuditClientService,
      );
      const pid = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
      const out = await svc.closePosition(
        pid,
        { operatorId: 'op-1', expectedEntityVersion: 2 },
        'corr-1',
      );
      expect(out).toEqual({ id: 'pos-1', quantity: '0' });
      expect(postJson.mock.calls[0]?.[0]).toContain(`/positions/${pid}/close`);
      expect(postJson.mock.calls[0]?.[1]).toMatchObject({
        operatorId: 'op-1',
        expectedEntityVersion: 2,
      });
      expect(
        (appendEntry.mock.calls[0]?.[0] as { action: string }).action,
      ).toBe('HERMES_CLOSE_POSITION_OK');
    });

    it('forwards approveReason / idempotencyKey / expectedEntityVersion when present', async () => {
      const postJson = jest
        .fn()
        .mockResolvedValue({ status: 200, json: {} });
      const upstream = { postJson } as unknown as HermesUpstreamService;
      const svc = makeService(upstream);
      await svc.closePosition('pos-1', {
        operatorId: 'op-1',
        approveReason: 'manual override',
        idempotencyKey: 'cccccccc-cccc-4ccc-cccc-cccccccccccc',
        expectedEntityVersion: 3,
      });
      expect(postJson.mock.calls[0]?.[1]).toMatchObject({
        operatorId: 'op-1',
        approveReason: 'manual override',
        idempotencyKey: 'cccccccc-cccc-4ccc-cccc-cccccccccccc',
        expectedEntityVersion: 3,
      });
    });

    it('throws HttpException on upstream >=400', async () => {
      const postJson = jest
        .fn()
        .mockResolvedValue({ status: 409, json: { detail: 'stale' } });
      const upstream = { postJson } as unknown as HermesUpstreamService;
      const svc = makeService(upstream);
      await expect(
        svc.closePosition('pos-1', { operatorId: 'op-1' }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('safe-mode mutations', () => {
    it('enableSafeMode flips state to enabled and audits HERMES_SAFE_MODE_ENABLE', async () => {
      const appendEntry = jest.fn().mockResolvedValue(undefined);
      const upstream = {
        postJson: jest.fn(),
      } as unknown as HermesUpstreamService;
      const svc = makeService(
        upstream,
        { appendEntry } as unknown as AuditClientService,
      );
      const res = (await svc.enableSafeMode(
        { operatorId: 'op-1', reason: 'drill' },
        'c',
      )) as { safeMode: { enabled: boolean; reason: string | null } };
      expect(res.safeMode.enabled).toBe(true);
      expect(res.safeMode.reason).toBe('drill');
      const audit = appendEntry.mock.calls[0]?.[0] as {
        action: string;
        actor: string;
        payload: { reason: string | null };
      };
      expect(audit.action).toBe('HERMES_SAFE_MODE_ENABLE');
      expect(audit.actor).toBe('op-1');
      expect(audit.payload.reason).toBe('drill');
    });

    it('enableSafeMode audits null reason when omitted', async () => {
      const appendEntry = jest.fn().mockResolvedValue(undefined);
      const upstream = {
        postJson: jest.fn(),
      } as unknown as HermesUpstreamService;
      const svc = makeService(
        upstream,
        { appendEntry } as unknown as AuditClientService,
      );
      await svc.enableSafeMode({ operatorId: 'op-1' });
      const audit = appendEntry.mock.calls[0]?.[0] as {
        payload: { reason: string | null };
      };
      expect(audit.payload.reason).toBeNull();
    });

    it('disableSafeMode flips state to disabled and audits HERMES_SAFE_MODE_DISABLE', async () => {
      const appendEntry = jest.fn().mockResolvedValue(undefined);
      const upstream = {
        postJson: jest.fn(),
      } as unknown as HermesUpstreamService;
      const svc = makeService(
        upstream,
        { appendEntry } as unknown as AuditClientService,
      );
      const res = (await svc.disableSafeMode(
        { operatorId: 'op-1', reason: 'all-clear' },
        'c',
      )) as { safeMode: { enabled: boolean; reason: string | null } };
      expect(res.safeMode.enabled).toBe(false);
      expect(res.safeMode.reason).toBe('all-clear');
      const audit = appendEntry.mock.calls[0]?.[0] as {
        action: string;
        actor: string;
      };
      expect(audit.action).toBe('HERMES_SAFE_MODE_DISABLE');
      expect(audit.actor).toBe('op-1');
    });

    it('disableSafeMode audits null reason when omitted', async () => {
      const appendEntry = jest.fn().mockResolvedValue(undefined);
      const upstream = {
        postJson: jest.fn(),
      } as unknown as HermesUpstreamService;
      const svc = makeService(
        upstream,
        { appendEntry } as unknown as AuditClientService,
      );
      await svc.disableSafeMode({ operatorId: 'op-1' });
      const audit = appendEntry.mock.calls[0]?.[0] as {
        payload: { reason: string | null };
      };
      expect(audit.payload.reason).toBeNull();
    });
  });

  describe('audit action suffix selection', () => {
    it('uses _HTTP_<n> suffix for failing outcomes across mutations', async () => {
      const appendEntry = jest.fn().mockResolvedValue(undefined);
      const postJson = jest
        .fn()
        .mockResolvedValue({ status: 403, json: 'forbidden' });
      const upstream = { postJson } as unknown as HermesUpstreamService;
      const svc = makeService(
        upstream,
        { appendEntry } as unknown as AuditClientService,
      );
      await expect(
        svc.beginExecution(uuid, { operatorId: 'op-1' }),
      ).rejects.toMatchObject({ status: 403 });
      const audit = appendEntry.mock.calls[0]?.[0] as { action: string };
      expect(audit.action).toBe('HERMES_BEGIN_EXECUTION_HTTP_403');
    });

    it('forwards approveReason=null in audit payload when dto field is absent', async () => {
      const appendEntry = jest.fn().mockResolvedValue(undefined);
      const postJson = jest
        .fn()
        .mockResolvedValue({ status: 200, json: {} });
      const upstream = { postJson } as unknown as HermesUpstreamService;
      const svc = makeService(
        upstream,
        { appendEntry } as unknown as AuditClientService,
      );
      await svc.beginExecution(uuid, { operatorId: 'op-1' });
      const audit = appendEntry.mock.calls[0]?.[0] as {
        payload: { approveReason: unknown; httpStatus: number };
      };
      expect(audit.payload.approveReason).toBeNull();
      expect(audit.payload.httpStatus).toBe(200);
    });
  });
});
