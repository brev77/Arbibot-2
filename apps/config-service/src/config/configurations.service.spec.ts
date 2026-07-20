import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AuditClientService } from '@arbibot/nest-platform';

import { ConfigurationsService } from './configurations.service';
import {
  ConfigScopeType,
  ConfigurationStatus,
} from '../dto/create-configuration.dto';
import { RedisConnection } from '../redis/redis-connection';

describe('ConfigurationsService', () => {
  const appendEntry = jest.fn().mockResolvedValue(undefined);
  const auditClient = {
    appendEntry,
  } as unknown as AuditClientService;

  /** No Redis — all reads go to mocked SQL. */
  const redisNoCache = { client: null } as RedisConnection;

  /** Redis mock with get/setEx/del controlled per-test. */
  let redisClient: { get: jest.Mock; setEx: jest.Mock; del: jest.Mock };
  let redisWithCache: { client: unknown };

  let configRepository: { query: jest.Mock };
  let service: ConfigurationsService;

  function mkRow(over: Record<string, unknown> = {}) {
    return {
      id: 'row-1',
      config_key: 'intake.throttling',
      config_value: '{}',
      is_sensitive: false,
      is_active: true,
      entity_version: 1,
      scope_type: ConfigScopeType.GLOBAL,
      scope_value: null,
      updated_by: 'op-1',
      approve_reason: null,
      created_at: new Date('2026-07-17T12:00:00Z'),
      updated_at: new Date('2026-07-17T12:00:00Z'),
      ...over,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    configRepository = { query: jest.fn() };
    redisClient = {
      get: jest.fn().mockResolvedValue(null),
      setEx: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };
    redisWithCache = { client: redisClient };
    service = new ConfigurationsService(
      redisNoCache,
      configRepository as never,
      auditClient,
    );
  });

  function buildServiceWithCache(): ConfigurationsService {
    return new ConfigurationsService(
      redisWithCache as RedisConnection,
      configRepository as never,
      auditClient,
    );
  }

  describe('promote', () => {
    it('inserts target scope row, deactivates source, and audits', async () => {
      const sourceRow = {
        id: 'src-id',
        config_key: 'paper.discovery.tokens',
        config_value: 'BTC',
        is_sensitive: false,
        entity_version: 2,
        created_at: new Date(),
        updated_at: new Date(),
        updated_by: 'op-1',
        scope_type: ConfigScopeType.ENVIRONMENT,
        scope_value: 'staging',
      };

      const targetRow = {
        id: 'tgt-id',
        config_key: 'paper.discovery.tokens',
        config_value: 'BTC',
        is_sensitive: false,
        entity_version: 1,
        created_at: new Date(),
        updated_at: new Date(),
        updated_by: 'op-2',
        scope_type: ConfigScopeType.GLOBAL,
        scope_value: null,
      };

      configRepository.query
        .mockResolvedValueOnce([sourceRow])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ next_version: 1 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([targetRow]);

      const result = await service.promote(
        'paper.discovery.tokens',
        {
          fromScopeType: ConfigScopeType.ENVIRONMENT,
          fromScopeValue: 'staging',
          toScopeType: ConfigScopeType.GLOBAL,
          toScopeValue: null,
        },
        'op-2',
      );

      expect(result.scopeType).toBe(ConfigScopeType.GLOBAL);
      expect(appendEntry).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CONFIG_PROMOTED' }),
      );

      const updateCall = configRepository.query.mock.calls.find(
        (c) =>
          typeof c[0] === 'string' &&
          c[0].includes('UPDATE policy_configurations') &&
          c[0].includes('is_active = false'),
      );
      expect(updateCall?.[1]).toEqual(expect.arrayContaining(['src-id']));
    });
  });

  describe('create with draft status', () => {
    it('inserts inactive row when status is draft', async () => {
      configRepository.query
        .mockResolvedValueOnce([{ next_version: 1 }])
        .mockResolvedValueOnce([]);

      await service.create(
        {
          configKey: 'draft.key',
          configValue: 'x',
          isSensitive: false,
          scopeType: ConfigScopeType.GLOBAL,
          status: ConfigurationStatus.DRAFT,
        },
        'op-1',
      );

      const insertCall = configRepository.query.mock.calls.find(
        (c) =>
          typeof c[0] === 'string' &&
          c[0].includes('INSERT INTO policy_configurations'),
      );
      expect(insertCall?.[1]).toEqual(expect.arrayContaining([false]));
    });
  });

  describe('updateStatus', () => {
    it('returns active row when latest version is already active', async () => {
      const activeRow = {
        id: 'a',
        config_key: 'k',
        config_value: 'v',
        is_sensitive: false,
        entity_version: 1,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
        updated_by: 'op',
        scope_type: ConfigScopeType.GLOBAL,
        scope_value: null,
      };

      configRepository.query
        .mockResolvedValueOnce([activeRow])
        .mockResolvedValueOnce([activeRow]);

      const out = await service.updateStatus(
        'k',
        { status: ConfigurationStatus.ACTIVE },
        'op',
      );

      expect(out.entityVersion).toBe(1);
      expect(
        configRepository.query.mock.calls.filter((c) =>
          String(c[0]).includes('INSERT INTO policy_configurations'),
        ),
      ).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Additional coverage: getAll / getEffective / getByKey / getHistory / update / rollback
  // ───────────────────────────────────────────────────────────────────────

  describe('getAll', () => {
    it('queries DB when cache miss (no Redis) and returns mapped rows', async () => {
      configRepository.query.mockResolvedValue([mkRow({ config_key: 'a' })]);
      const result = await service.getAll(undefined);
      expect(result).toHaveLength(1);
      expect(result[0]?.configKey).toBe('a');
    });

    it('applies scope filter when scopeType provided', async () => {
      configRepository.query.mockResolvedValue([]);
      await service.getAll({ scopeType: ConfigScopeType.ENVIRONMENT, scopeValue: 'staging' });
      const sql = configRepository.query.mock.calls[0][0] as string;
      expect(sql).toContain('scope_type');
      expect(sql).toContain('scope_value');
    });

    it('derives scopeType from environment query param', async () => {
      configRepository.query.mockResolvedValue([]);
      await service.getAll({ environment: 'staging' });
      const params = configRepository.query.mock.calls[0][1];
      expect(params).toContain('environment');
      expect(params).toContain('staging');
    });

    it('derives scopeType from tenantId query param', async () => {
      configRepository.query.mockResolvedValue([]);
      await service.getAll({ tenantId: 't-1' });
      const params = configRepository.query.mock.calls[0][1];
      expect(params).toContain('tenant');
      expect(params).toContain('t-1');
    });

    it('returns cached rows on Redis cache hit (no DB query)', async () => {
      const cached = [{ configKey: 'cached-key' }];
      redisClient.get.mockResolvedValue(JSON.stringify(cached));
      const svc = buildServiceWithCache();
      const result = await svc.getAll(undefined);
      expect(result).toEqual(cached);
      expect(configRepository.query).not.toHaveBeenCalled();
    });

    it('falls back to DB when Redis get throws', async () => {
      redisClient.get.mockRejectedValue(new Error('redis down'));
      configRepository.query.mockResolvedValue([mkRow()]);
      const svc = buildServiceWithCache();
      const result = await svc.getAll(undefined);
      expect(result).toHaveLength(1);
      expect(configRepository.query).toHaveBeenCalled();
    });

    it('swallows Redis setEx errors after DB fetch', async () => {
      redisClient.setEx.mockRejectedValue(new Error('setEx fail'));
      configRepository.query.mockResolvedValue([mkRow()]);
      const svc = buildServiceWithCache();
      const result = await svc.getAll(undefined);
      expect(result).toHaveLength(1);
    });

    it('sets cache after DB fetch when Redis available', async () => {
      configRepository.query.mockResolvedValue([mkRow()]);
      const svc = buildServiceWithCache();
      await svc.getAll(undefined);
      expect(redisClient.setEx).toHaveBeenCalled();
    });
  });

  describe('getEffective', () => {
    it('returns null when DB has no matching row', async () => {
      configRepository.query.mockResolvedValue([]);
      const result = await service.getEffective('missing.key');
      expect(result).toBeNull();
    });

    it('returns mapped row when DB has match', async () => {
      configRepository.query.mockResolvedValue([mkRow({ config_value: '{"x":1}' })]);
      const result = await service.getEffective('intake.throttling');
      expect(result?.configKey).toBe('intake.throttling');
      expect(result?.configValue).toBe('{"x":1}');
    });

    it('forwards environment and tenantId to SQL', async () => {
      configRepository.query.mockResolvedValue([mkRow()]);
      await service.getEffective('k', 'staging', 't-1');
      const params = configRepository.query.mock.calls[0][1];
      expect(params).toContain('staging');
      expect(params).toContain('t-1');
    });

    it('returns cached value on Redis hit', async () => {
      const cached = { configKey: 'cached', configValue: '{}', entityVersion: 1 };
      redisClient.get.mockResolvedValue(JSON.stringify(cached));
      const svc = buildServiceWithCache();
      const result = await svc.getEffective('k');
      expect(result?.configKey).toBe('cached');
      expect(configRepository.query).not.toHaveBeenCalled();
    });

    it('falls back to DB when Redis get throws', async () => {
      redisClient.get.mockRejectedValue(new Error('redis get fail'));
      configRepository.query.mockResolvedValue([mkRow()]);
      const svc = buildServiceWithCache();
      const result = await svc.getEffective('k');
      expect(result).not.toBeNull();
    });
  });

  describe('getByKey', () => {
    it('returns null when row missing', async () => {
      configRepository.query.mockResolvedValue([]);
      const result = await service.getByKey('missing');
      expect(result).toBeNull();
    });

    it('returns mapped row when found', async () => {
      configRepository.query.mockResolvedValue([mkRow()]);
      const result = await service.getByKey('intake.throttling');
      expect(result?.configKey).toBe('intake.throttling');
    });

    it('forwards scope filter to SQL', async () => {
      configRepository.query.mockResolvedValue([mkRow()]);
      await service.getByKey('k', ConfigScopeType.ENVIRONMENT, 'staging');
      const sql = configRepository.query.mock.calls[0][0] as string;
      expect(sql).toContain('scope_type');
    });

    it('returns cached row on Redis hit', async () => {
      const cached = { configKey: 'cached' };
      redisClient.get.mockResolvedValue(JSON.stringify(cached));
      const svc = buildServiceWithCache();
      const result = await svc.getByKey('k');
      expect(result?.configKey).toBe('cached');
    });
  });

  describe('getHistory', () => {
    it('returns history items mapped from DB', async () => {
      configRepository.query.mockResolvedValue([
        {
          id: 'h1',
          config_key: 'k',
          config_value: 'v1',
          is_sensitive: false,
          is_active: true,
          entity_version: 1,
          scope_type: ConfigScopeType.GLOBAL,
          scope_value: null,
          updated_by: 'op',
          approve_reason: null,
          created_at: new Date('2026-07-17T10:00:00Z'),
          updated_at: new Date('2026-07-17T10:00:00Z'),
        },
      ]);
      const result = await service.getHistory('k');
      expect(result).toHaveLength(1);
      expect(result[0]?.entityVersion).toBe(1);
    });

    it('returns empty array when no history', async () => {
      configRepository.query.mockResolvedValue([]);
      const result = await service.getHistory('k');
      expect(result).toEqual([]);
    });

    it('defaults scopeType to GLOBAL when omitted', async () => {
      configRepository.query.mockResolvedValue([]);
      await service.getHistory('k');
      const params = configRepository.query.mock.calls[0][1];
      expect(params).toContain('global');
    });
  });

  describe('create — sensitive key validation', () => {
    it('throws BadRequestException when sensitive key lacks approveReason', async () => {
      await expect(
        service.create(
          {
            configKey: 'risk.threshold',
            configValue: '0.5',
            isSensitive: true,
            scopeType: ConfigScopeType.GLOBAL,
          },
          'op-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates active row when status is active (omitted)', async () => {
      configRepository.query
        .mockResolvedValueOnce([{ next_version: 1 }])
        .mockResolvedValueOnce([mkRow({ is_active: true })]);

      const result = await service.create(
        {
          configKey: 'intake.throttling',
          configValue: '{}',
          isSensitive: false,
          scopeType: ConfigScopeType.GLOBAL,
        },
        'op-1',
      );

      expect(result).toBeDefined();
      const insertCall = configRepository.query.mock.calls.find(
        (c) =>
          typeof c[0] === 'string' &&
          c[0].includes('INSERT INTO policy_configurations'),
      );
      expect(insertCall?.[1]).toEqual(expect.arrayContaining([true]));
    });
  });

  describe('update', () => {
    it('throws NotFoundException when config not found', async () => {
      configRepository.query.mockResolvedValue([]);
      await expect(
        service.update(
          'missing.key',
          { configValue: 'v', isSensitive: false, scopeType: ConfigScopeType.GLOBAL },
          'op-1',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequestException when updating sensitive key without approveReason', async () => {
      configRepository.query.mockResolvedValue([mkRow({ config_key: 'risk.threshold' })]);
      await expect(
        service.update(
          'risk.threshold',
          {
            configValue: '0.5',
            isSensitive: true,
            scopeType: ConfigScopeType.GLOBAL,
          },
          'op-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('happy path: creates new active version', async () => {
      configRepository.query
        .mockResolvedValueOnce([mkRow({ entity_version: 1 })]) // getByKey
        .mockResolvedValueOnce([{ next_version: 2 }]) // next version
        .mockResolvedValueOnce([mkRow({ entity_version: 2, config_value: 'new' })]); // inserted row

      const result = await service.update(
        'intake.throttling',
        {
          configValue: 'new',
          isSensitive: false,
          scopeType: ConfigScopeType.GLOBAL,
        },
        'op-1',
      );

      expect(result.configValue).toBe('new');
      expect(appendEntry).toHaveBeenCalled();
    });
  });

  describe('rollback', () => {
    it('throws BadRequestException when rolling back sensitive key without approveReason', async () => {
      await expect(
        service.rollback(
          'risk.threshold',
          {
            toVersion: 1,
            isSensitive: true,
          },
          'op-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when rollback returns no rows', async () => {
      configRepository.query.mockResolvedValue([]);
      await expect(
        service.rollback(
          'intake.throttling',
          { toVersion: 1, isSensitive: false },
          'op-1',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('happy path: rolls back and audits', async () => {
      configRepository.query.mockResolvedValue([mkRow({ entity_version: 1 })]);
      const result = await service.rollback(
        'intake.throttling',
        { toVersion: 1, isSensitive: false },
        'op-1',
      );
      expect(result).toBeDefined();
      expect(appendEntry).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CONFIG_ROLLBACK' }),
      );
    });
  });

  describe('promote — additional branches', () => {
    it('throws BadRequestException when source and target scopes are identical', async () => {
      await expect(
        service.promote(
          'k',
          {
            fromScopeType: ConfigScopeType.GLOBAL,
            fromScopeValue: null,
            toScopeType: ConfigScopeType.GLOBAL,
            toScopeValue: null,
          },
          'op-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when promoting sensitive key without approveReason', async () => {
      await expect(
        service.promote(
          'risk.threshold',
          {
            fromScopeType: ConfigScopeType.GLOBAL,
            fromScopeValue: null,
            toScopeType: ConfigScopeType.ENVIRONMENT,
            toScopeValue: 'staging',
          },
          'op-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when source config is missing', async () => {
      configRepository.query.mockResolvedValue([]);
      await expect(
        service.promote(
          'missing.key',
          {
            fromScopeType: ConfigScopeType.GLOBAL,
            fromScopeValue: null,
            toScopeType: ConfigScopeType.ENVIRONMENT,
            toScopeValue: 'staging',
          },
          'op-1',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException when target scope already has an active row', async () => {
      const sourceRow = mkRow({ scope_type: ConfigScopeType.GLOBAL });
      const targetRow = mkRow({ scope_type: ConfigScopeType.ENVIRONMENT });
      configRepository.query
        .mockResolvedValueOnce([sourceRow])
        .mockResolvedValueOnce([targetRow]);
      await expect(
        service.promote(
          'intake.throttling',
          {
            fromScopeType: ConfigScopeType.GLOBAL,
            fromScopeValue: null,
            toScopeType: ConfigScopeType.ENVIRONMENT,
            toScopeValue: 'staging',
          },
          'op-1',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('returns cached idempotent result when idempotencyKey is in cache', async () => {
      const cached = { configKey: 'k', entityVersion: 5 };
      redisClient.get.mockResolvedValue(JSON.stringify(cached));
      const svc = buildServiceWithCache();
      const result = await svc.promote(
        'k',
        {
          fromScopeType: ConfigScopeType.GLOBAL,
          fromScopeValue: null,
          toScopeType: ConfigScopeType.ENVIRONMENT,
          toScopeValue: 'staging',
          idempotencyKey: 'idem-1',
        },
        'op-1',
      );
      expect(result?.entityVersion).toBe(5);
      expect(configRepository.query).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus — additional branches', () => {
    it('throws BadRequestException when status is not ACTIVE', async () => {
      await expect(
        service.updateStatus(
          'k',
          { status: ConfigurationStatus.DRAFT },
          'op-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when updating sensitive key status without approveReason', async () => {
      await expect(
        service.updateStatus(
          'risk.threshold',
          { status: ConfigurationStatus.ACTIVE },
          'op-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when config not found', async () => {
      configRepository.query.mockResolvedValue([]);
      await expect(
        service.updateStatus(
          'missing.key',
          { status: ConfigurationStatus.ACTIVE },
          'op-1',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('activates draft row by inserting new active version', async () => {
      const draftRow = mkRow({ is_active: false, entity_version: 2 });
      const activeRow = mkRow({ is_active: true, entity_version: 3 });
      configRepository.query
        .mockResolvedValueOnce([draftRow]) // get latest
        .mockResolvedValueOnce([draftRow]) // get latest again (for activation)
        .mockResolvedValueOnce([{ next_version: 3 }]) // next version
        .mockResolvedValueOnce([]) // deactivate old
        .mockResolvedValueOnce([activeRow]); // inserted

      const result = await service.updateStatus(
        'intake.throttling',
        { status: ConfigurationStatus.ACTIVE },
        'op-1',
      );

      expect(result.entityVersion).toBe(3);
      expect(appendEntry).toHaveBeenCalled();
    });
  });
});
