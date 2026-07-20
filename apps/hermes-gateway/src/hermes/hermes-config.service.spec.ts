import { ForbiddenException } from '@nestjs/common';
import { AuditClientService } from '@arbibot/nest-platform';

import {
  ConfigPromoteDto,
  ConfigRollbackDto,
  ConfigScopeType,
  ConfigStatusDto,
  ConfigUpdateDto,
  ConfigurationStatus,
} from './dto/config-mutation.dto';
import { HermesConfigService } from './hermes-config.service';
import { HermesUpstreamService } from './hermes-upstream.service';

/**
 * HermesConfigService spec (Plan 6).
 *
 * Verifies the gateway-side config-key allowlist: safe keys (intake/paper/
 * opportunity/dex/features) are forwarded to config-service with operatorId
 * + approveReason; sensitive keys (risk/execution/capital) raise 403 BEFORE
 * any upstream call. Also checks audit action naming and URL construction.
 */
describe('HermesConfigService', () => {
  const makeService = (
    upstream: HermesUpstreamService,
    audit?: AuditClientService,
  ) =>
    new HermesConfigService(
      upstream,
      audit ??
        ({
          appendEntry: jest.fn().mockResolvedValue(undefined),
        } as unknown as AuditClientService),
    );

  describe('allowlist enforcement', () => {
    it('blocks risk.* keys with ForbiddenException (no upstream call)', async () => {
      const putJson = jest.fn();
      const upstream = { putJson } as unknown as HermesUpstreamService;
      const svc = makeService(upstream);
      await expect(
        svc.updateConfig(
          'risk.evaluation',
          { operatorId: 'op-1', configValue: '{}', approveReason: 'try' },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(putJson).not.toHaveBeenCalled();
    });

    it('blocks execution.* and capital.* keys', async () => {
      const upstream = { putJson: jest.fn() } as unknown as HermesUpstreamService;
      const svc = makeService(upstream);
      await expect(
        svc.updateConfig(
          'execution.plan',
          { operatorId: 'op-1', configValue: '{}', approveReason: 'x' },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        svc.updateConfig(
          'capital.reservation',
          { operatorId: 'op-1', configValue: '{}', approveReason: 'x' },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('forbids rollback / promote / activate for sensitive keys too', async () => {
      const upstream = {
        postJson: jest.fn(),
        patchJson: jest.fn(),
      } as unknown as HermesUpstreamService;
      const svc = makeService(upstream);
      await expect(
        svc.rollbackConfig('risk.limits.bundle', {
          operatorId: 'op-1',
          toVersion: 2,
          approveReason: 'x',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      const promoteDto: ConfigPromoteDto = {
        operatorId: 'op-1',
        fromScopeType: ConfigScopeType.GLOBAL,
        toScopeType: ConfigScopeType.ENVIRONMENT,
        approveReason: 'x',
      };
      await expect(svc.promoteConfig('execution.plan', promoteDto)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      const statusDto: ConfigStatusDto = {
        operatorId: 'op-1',
        status: ConfigurationStatus.ACTIVE,
        approveReason: 'x',
      };
      await expect(svc.activateConfig('capital.reservation', statusDto)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(upstream.postJson).not.toHaveBeenCalled();
      expect(upstream.patchJson).not.toHaveBeenCalled();
    });
  });

  describe('updateConfig (safe key)', () => {
    it('PUTs to config-service with operatorId + approveReason and audits _OK', async () => {
      const appendEntry = jest.fn().mockResolvedValue(undefined);
      const putJson = jest
        .fn()
        .mockResolvedValue({ status: 200, json: { configKey: 'dex.limits', entityVersion: 5 } });
      const upstream = { putJson } as unknown as HermesUpstreamService;
      const svc = makeService(upstream, { appendEntry } as unknown as AuditClientService);

      const out = await svc.updateConfig(
        'dex.limits',
        { operatorId: 'op-1', configValue: '{"killSwitch":false}', approveReason: 'release live' },
        'corr-1',
      );
      expect(out).toEqual({ configKey: 'dex.limits', entityVersion: 5 });

      const [url, body, corr] = putJson.mock.calls[0]!;
      expect(url).toContain('/policy/configurations/dex.limits');
      expect(body).toMatchObject({
        operatorId: 'op-1',
        configValue: '{"killSwitch":false}',
        approveReason: 'release live',
      });
      expect(corr).toBe('corr-1');

      const audit = appendEntry.mock.calls[0]?.[0] as {
        action: string;
        resourceType: string;
        resourceId: string;
      };
      expect(audit.action).toBe('HERMES_CONFIG_UPDATE_OK');
      expect(audit.resourceType).toBe('policy_configuration');
      expect(audit.resourceId).toBe('dex.limits');
    });

    it('audits _HTTP_<n> and rethrows on upstream 4xx', async () => {
      const appendEntry = jest.fn().mockResolvedValue(undefined);
      const putJson = jest.fn().mockResolvedValue({ status: 400, json: { error: 'bad' } });
      const upstream = { putJson } as unknown as HermesUpstreamService;
      const svc = makeService(upstream, { appendEntry } as unknown as AuditClientService);

      await expect(
        svc.updateConfig('intake.throttling', { operatorId: 'op-1', configValue: '{}' }),
      ).rejects.toMatchObject({ status: 400 });
      expect(
        (appendEntry.mock.calls[0]?.[0] as { action: string }).action,
      ).toBe('HERMES_CONFIG_UPDATE_HTTP_400');
    });

    it('remaps upstream 5xx to BAD_GATEWAY (502)', async () => {
      const putJson = jest
        .fn()
        .mockResolvedValue({ status: 503, json: 'upstream error' });
      const upstream = { putJson } as unknown as HermesUpstreamService;
      const svc = makeService(upstream);
      await expect(
        svc.updateConfig('intake.throttling', {
          operatorId: 'op-1',
          configValue: '{}',
        }),
      ).rejects.toMatchObject({ status: 502 });
    });

    it('forwards scopeType/scopeValue/status/approveReason when provided', async () => {
      const putJson = jest.fn().mockResolvedValue({ status: 200, json: {} });
      const upstream = { putJson } as unknown as HermesUpstreamService;
      const svc = makeService(upstream);
      const dto: ConfigUpdateDto = {
        operatorId: 'op-1',
        configValue: '{}',
        scopeType: ConfigScopeType.TENANT,
        scopeValue: 't-tenant',
        status: ConfigurationStatus.DRAFT,
        approveReason: 'stage',
      };
      await svc.updateConfig('paper.discovery', dto);
      const body = putJson.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(body.scopeType).toBe(ConfigScopeType.TENANT);
      expect(body.scopeValue).toBe('t-tenant');
      expect(body.status).toBe(ConfigurationStatus.DRAFT);
      expect(body.approveReason).toBe('stage');
    });

    it('omits optional scope/status fields when not provided', async () => {
      const putJson = jest.fn().mockResolvedValue({ status: 200, json: {} });
      const upstream = { putJson } as unknown as HermesUpstreamService;
      const svc = makeService(upstream);
      await svc.updateConfig('paper.discovery', {
        operatorId: 'op-1',
        configValue: '{}',
      });
      const body = putJson.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(body).not.toHaveProperty('scopeType');
      expect(body).not.toHaveProperty('status');
      expect(body).not.toHaveProperty('approveReason');
    });
  });

  describe('rollbackConfig (safe key)', () => {
    it('POSTs to /rollback with toVersion', async () => {
      const postJson = jest.fn().mockResolvedValue({ status: 200, json: { rollbackId: 'r1' } });
      const upstream = { postJson } as unknown as HermesUpstreamService;
      const svc = makeService(upstream);
      await svc.rollbackConfig('dex.limits', {
        operatorId: 'op-1',
        toVersion: 2,
        approveReason: 'revert',
      });
      const [url, body] = postJson.mock.calls[0]!;
      expect(String(url)).toContain('/policy/configurations/dex.limits/rollback');
      expect(body).toMatchObject({ toVersion: 2, operatorId: 'op-1' });
    });

    it('forwards scopeType/scopeValue when provided', async () => {
      const postJson = jest.fn().mockResolvedValue({ status: 200, json: {} });
      const upstream = { postJson } as unknown as HermesUpstreamService;
      const svc = makeService(upstream);
      const dto: ConfigRollbackDto = {
        operatorId: 'op-1',
        toVersion: 5,
        scopeType: ConfigScopeType.ENVIRONMENT,
        scopeValue: 'paper',
      };
      await svc.rollbackConfig('intake.throttling', dto);
      const body = postJson.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(body.scopeType).toBe(ConfigScopeType.ENVIRONMENT);
      expect(body.scopeValue).toBe('paper');
    });

    it('remaps upstream 5xx to BAD_GATEWAY (502)', async () => {
      const postJson = jest
        .fn()
        .mockResolvedValue({ status: 500, json: 'err' });
      const upstream = { postJson } as unknown as HermesUpstreamService;
      const svc = makeService(upstream);
      await expect(
        svc.rollbackConfig('dex.limits', { operatorId: 'op-1', toVersion: 1 }),
      ).rejects.toMatchObject({ status: 502 });
    });

    it('audits HERMES_CONFIG_ROLLBACK_OK on success', async () => {
      const appendEntry = jest.fn().mockResolvedValue(undefined);
      const postJson = jest.fn().mockResolvedValue({ status: 200, json: {} });
      const upstream = { postJson } as unknown as HermesUpstreamService;
      const svc = makeService(upstream, { appendEntry } as unknown as AuditClientService);
      await svc.rollbackConfig('dex.limits', { operatorId: 'op-1', toVersion: 2 });
      const audit = appendEntry.mock.calls[0]?.[0] as { action: string };
      expect(audit.action).toBe('HERMES_CONFIG_ROLLBACK_OK');
    });
  });

  describe('promoteConfig (safe key)', () => {
    it('POSTs to /promote with from/to scopes and audits _OK', async () => {
      const appendEntry = jest.fn().mockResolvedValue(undefined);
      const postJson = jest
        .fn()
        .mockResolvedValue({ status: 200, json: { promotionId: 'pr1' } });
      const upstream = { postJson } as unknown as HermesUpstreamService;
      const svc = makeService(upstream, { appendEntry } as unknown as AuditClientService);
      const dto: ConfigPromoteDto = {
        operatorId: 'op-1',
        fromScopeType: ConfigScopeType.GLOBAL,
        fromScopeValue: undefined,
        toScopeType: ConfigScopeType.ENVIRONMENT,
        toScopeValue: 'paper',
        approveReason: 'rollout',
        idempotencyKey: 'idem-1',
      };
      await svc.promoteConfig('paper.discovery', dto);
      const [url, body] = postJson.mock.calls[0]!;
      expect(String(url)).toContain('/policy/configurations/paper.discovery/promote');
      expect(body).toMatchObject({
        fromScopeType: ConfigScopeType.GLOBAL,
        toScopeType: ConfigScopeType.ENVIRONMENT,
        toScopeValue: 'paper',
        idempotencyKey: 'idem-1',
      });
      const audit = appendEntry.mock.calls[0]?.[0] as {
        action: string;
        idempotencyKey: string;
      };
      expect(audit.action).toBe('HERMES_CONFIG_PROMOTE_OK');
      expect(audit.idempotencyKey).toBe('idem-1');
    });

    it('remaps upstream 4xx to the original status code', async () => {
      const postJson = jest
        .fn()
        .mockResolvedValue({ status: 409, json: 'stale' });
      const upstream = { postJson } as unknown as HermesUpstreamService;
      const svc = makeService(upstream);
      await expect(
        svc.promoteConfig('dex.limits', {
          operatorId: 'op-1',
          fromScopeType: ConfigScopeType.GLOBAL,
          toScopeType: ConfigScopeType.ENVIRONMENT,
        }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('activateConfig (safe key)', () => {
    it('PATCHes /status with status=active', async () => {
      const patchJson = jest.fn().mockResolvedValue({ status: 200, json: {} });
      const upstream = { patchJson } as unknown as HermesUpstreamService;
      const svc = makeService(upstream);
      const dto: ConfigStatusDto = {
        operatorId: 'op-1',
        status: ConfigurationStatus.ACTIVE,
        approveReason: 'go',
      };
      await svc.activateConfig('features.flags', dto);
      const [url, body] = patchJson.mock.calls[0]!;
      expect(String(url)).toContain('/policy/configurations/features.flags/status');
      expect(body).toMatchObject({ status: 'active', operatorId: 'op-1' });
    });

    it('forwards scope when provided', async () => {
      const patchJson = jest.fn().mockResolvedValue({ status: 200, json: {} });
      const upstream = { patchJson } as unknown as HermesUpstreamService;
      const svc = makeService(upstream);
      const dto: ConfigStatusDto = {
        operatorId: 'op-1',
        status: ConfigurationStatus.ACTIVE,
        scopeType: ConfigScopeType.TENANT,
        scopeValue: 't1',
      };
      await svc.activateConfig('features.flags', dto);
      const body = patchJson.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(body.scopeType).toBe(ConfigScopeType.TENANT);
      expect(body.scopeValue).toBe('t1');
    });

    it('audits HERMES_CONFIG_STATUS_OK on success', async () => {
      const appendEntry = jest.fn().mockResolvedValue(undefined);
      const patchJson = jest.fn().mockResolvedValue({ status: 200, json: {} });
      const upstream = { patchJson } as unknown as HermesUpstreamService;
      const svc = makeService(upstream, { appendEntry } as unknown as AuditClientService);
      await svc.activateConfig('features.flags', {
        operatorId: 'op-1',
        status: ConfigurationStatus.ACTIVE,
      });
      const audit = appendEntry.mock.calls[0]?.[0] as { action: string };
      expect(audit.action).toBe('HERMES_CONFIG_STATUS_OK');
    });
  });
});
