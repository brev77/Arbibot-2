import { HttpException, HttpStatus } from '@nestjs/common';

import {
  ConfigPromoteDto,
  ConfigRollbackDto,
  ConfigScopeType,
  ConfigStatusDto,
  ConfigUpdateDto,
  ConfigurationStatus,
} from './dto/config-mutation.dto';
import { HermesConfigReadController, HermesConfigMutationController } from './hermes-config.controller';
import { HermesConfigService } from './hermes-config.service';
import { HermesUpstreamService } from './hermes-upstream.service';

/**
 * hermes-config controllers spec (Plan 6 — controller coverage).
 *
 * ReadController is a thin read-through proxy over HermesUpstreamService.getJson
 * for /policy/configurations/* endpoints. It forwards scope query-strings,
 * builds the URL, and throws HttpException on upstream >=400.
 *
 * MutationController is a thin delegation layer to HermesConfigService for
 * update/rollback/promote/activate — each handler extracts the configKey +
 * body + correlation id, then delegates to the service. @HttpCode(200) on
 * each mutating handler is the only decorator-level concern.
 */
describe('HermesConfigReadController', () => {
  let upstream: { getJson: jest.Mock };
  let controller: HermesConfigReadController;

  beforeEach(() => {
    upstream = { getJson: jest.fn() };
    controller = new HermesConfigReadController(
      upstream as unknown as HermesUpstreamService,
    );
  });

  describe('list', () => {
    it('proxies to /policy/configurations with no query when scope omitted', async () => {
      upstream.getJson.mockResolvedValue({ status: 200, json: { items: [] } });
      const out = await controller.list({ correlationId: 'c1' });
      expect(out).toEqual({ items: [] });
      const url = String(upstream.getJson.mock.calls[0]?.[0]);
      expect(url).toMatch(/\/policy\/configurations$/);
      expect(url).not.toContain('?');
      expect(upstream.getJson.mock.calls[0]?.[1]).toBe('c1');
    });

    it('appends scopeType/scopeValue query when provided', async () => {
      upstream.getJson.mockResolvedValue({ status: 200, json: [] });
      await controller.list({}, ConfigScopeType.TENANT, 't-tenant');
      const url = String(upstream.getJson.mock.calls[0]?.[0]);
      expect(url).toContain('scopeType=tenant');
      expect(url).toContain('scopeValue=t-tenant');
    });

    it('omits empty-string query values', async () => {
      upstream.getJson.mockResolvedValue({ status: 200, json: [] });
      await controller.list({}, '', '');
      const url = String(upstream.getJson.mock.calls[0]?.[0]);
      expect(url).not.toContain('?');
    });

    it('forwards undefined correlation id when req.correlationId is absent', async () => {
      upstream.getJson.mockResolvedValue({ status: 200, json: {} });
      await controller.list({});
      expect(upstream.getJson.mock.calls[0]?.[1]).toBeUndefined();
    });

    it('treats empty-string correlation id as undefined', async () => {
      upstream.getJson.mockResolvedValue({ status: 200, json: {} });
      await controller.list({ correlationId: '' });
      expect(upstream.getJson.mock.calls[0]?.[1]).toBeUndefined();
    });

    it('throws HttpException on upstream 4xx', async () => {
      upstream.getJson.mockResolvedValue({
        status: 404,
        json: 'not found',
      });
      await expect(controller.list({})).rejects.toMatchObject({
        status: 404,
      });
    });

    it('remaps upstream 5xx to BAD_GATEWAY (502)', async () => {
      upstream.getJson.mockResolvedValue({
        status: 503,
        json: { error: 'unavailable' },
      });
      try {
        await controller.list({});
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(HttpException);
        expect((e as HttpException).getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      }
    });
  });

  describe('getByKey', () => {
    it('URL-encodes the configKey', async () => {
      upstream.getJson.mockResolvedValue({ status: 200, json: {} });
      await controller.getByKey({}, 'intake.throttling');
      const url = String(upstream.getJson.mock.calls[0]?.[0]);
      expect(url).toContain('/policy/configurations/intake.throttling');
    });
  });

  describe('getEffective', () => {
    it('forwards environment/tenantId query when provided', async () => {
      upstream.getJson.mockResolvedValue({ status: 200, json: {} });
      await controller.getEffective({}, 'dex.limits', 'paper', 't1');
      const url = String(upstream.getJson.mock.calls[0]?.[0]);
      expect(url).toContain('/effective');
      expect(url).toContain('environment=paper');
      expect(url).toContain('tenantId=t1');
    });

    it('omits both environment and tenantId when undefined', async () => {
      upstream.getJson.mockResolvedValue({ status: 200, json: {} });
      await controller.getEffective({}, 'dex.limits');
      const url = String(upstream.getJson.mock.calls[0]?.[0]);
      expect(url).not.toContain('?');
    });
  });

  describe('getHistory', () => {
    it('builds /history URL with scopeType when provided', async () => {
      upstream.getJson.mockResolvedValue({ status: 200, json: [] });
      await controller.getHistory({}, 'paper.discovery', ConfigScopeType.GLOBAL);
      const url = String(upstream.getJson.mock.calls[0]?.[0]);
      expect(url).toContain('/policy/configurations/paper.discovery/history');
      expect(url).toContain('scopeType=global');
    });
  });
});

describe('HermesConfigMutationController', () => {
  let config: {
    updateConfig: jest.Mock;
    rollbackConfig: jest.Mock;
    promoteConfig: jest.Mock;
    activateConfig: jest.Mock;
  };
  let controller: HermesConfigMutationController;

  beforeEach(() => {
    config = {
      updateConfig: jest.fn().mockResolvedValue({ ok: true }),
      rollbackConfig: jest.fn().mockResolvedValue({ ok: true }),
      promoteConfig: jest.fn().mockResolvedValue({ ok: true }),
      activateConfig: jest.fn().mockResolvedValue({ ok: true }),
    };
    controller = new HermesConfigMutationController(
      config as unknown as HermesConfigService,
    );
  });

  it('update delegates configKey + body + correlationId to service.updateConfig', async () => {
    const body: ConfigUpdateDto = {
      operatorId: 'op-1',
      configValue: '{}',
    };
    await controller.update({ correlationId: 'c1' }, 'dex.limits', body);
    expect(config.updateConfig).toHaveBeenCalledWith('dex.limits', body, 'c1');
  });

  it('update forwards undefined correlationId when absent', async () => {
    await controller.update({}, 'intake.throttling', {
      operatorId: 'op-1',
      configValue: '{}',
    });
    expect(config.updateConfig).toHaveBeenCalledWith(
      'intake.throttling',
      expect.objectContaining({ operatorId: 'op-1' }),
      undefined,
    );
  });

  it('rollback delegates to service.rollbackConfig', async () => {
    const body: ConfigRollbackDto = {
      operatorId: 'op-1',
      toVersion: 3,
    };
    await controller.rollback({ correlationId: 'c' }, 'dex.limits', body);
    expect(config.rollbackConfig).toHaveBeenCalledWith('dex.limits', body, 'c');
  });

  it('promote delegates to service.promoteConfig', async () => {
    const body: ConfigPromoteDto = {
      operatorId: 'op-1',
      fromScopeType: ConfigScopeType.GLOBAL,
      toScopeType: ConfigScopeType.ENVIRONMENT,
    };
    await controller.promote({ correlationId: 'c' }, 'paper.discovery', body);
    expect(config.promoteConfig).toHaveBeenCalledWith(
      'paper.discovery',
      body,
      'c',
    );
  });

  it('activate delegates to service.activateConfig', async () => {
    const body: ConfigStatusDto = {
      operatorId: 'op-1',
      status: ConfigurationStatus.ACTIVE,
    };
    await controller.activate({ correlationId: 'c' }, 'features.flags', body);
    expect(config.activateConfig).toHaveBeenCalledWith(
      'features.flags',
      body,
      'c',
    );
  });

  it('HttpCode(200) decorator is applied to all mutation handlers', () => {
    expect(Reflect.getMetadata('__httpCode__', controller.update)).toBe(
      HttpStatus.OK,
    );
    expect(Reflect.getMetadata('__httpCode__', controller.rollback)).toBe(
      HttpStatus.OK,
    );
    expect(Reflect.getMetadata('__httpCode__', controller.promote)).toBe(
      HttpStatus.OK,
    );
    expect(Reflect.getMetadata('__httpCode__', controller.activate)).toBe(
      HttpStatus.OK,
    );
  });

  it('returns the value produced by the service verbatim', async () => {
    config.updateConfig.mockResolvedValue({ configKey: 'dex.limits', entityVersion: 7 });
    const out = await controller.update({}, 'dex.limits', {
      operatorId: 'op-1',
      configValue: '{}',
    });
    expect(out).toEqual({ configKey: 'dex.limits', entityVersion: 7 });
  });
});
