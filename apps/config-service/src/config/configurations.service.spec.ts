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

  let configRepository: { query: jest.Mock };
  let service: ConfigurationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    configRepository = { query: jest.fn() };
    service = new ConfigurationsService(
      redisNoCache,
      configRepository as never,
      auditClient,
    );
  });

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
});
