import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { AuditClientService } from '@arbibot/nest-platform';
import { PolicyConfigurationEntity } from '@arbibot/persistence';

import {
  CreateConfigurationDto,
  QueryConfigurationsDto,
  ConfigScopeType,
} from '../dto/create-configuration.dto';
import {
  ConfigurationResponseDto,
  ConfigurationHistoryItemDto,
  RollbackResponseDto,
} from '../dto/configuration-response.dto';
import { RollbackConfigurationDto } from '../dto/rollback-configuration.dto';
import { RedisConnection } from '../redis/redis-connection';

const CACHE_TTL_SECONDS = 60;
const SENSITIVE_KEYS_PATTERN = /^(risk\..*|execution\..*|capital\..*)/;

@Injectable()
export class ConfigurationsService {
  private readonly logger = new Logger(ConfigurationsService.name);

  constructor(
    private readonly redis: RedisConnection,
    @InjectRepository(PolicyConfigurationEntity)
    private readonly configRepository: Repository<PolicyConfigurationEntity>,
    private readonly auditClient: AuditClientService,
  ) {}

  /**
   * Get all latest configurations with optional scope filtering.
   * Fallback to DB if cache miss or Redis unavailable.
   */
  async getAll(
    query?: QueryConfigurationsDto,
  ): Promise<ConfigurationResponseDto[]> {
    // Normalize convenience params
    const scopeType: ConfigScopeType | undefined =
      query?.scopeType ||
      (query?.environment ? ConfigScopeType.ENVIRONMENT : undefined) ||
      (query?.tenantId ? ConfigScopeType.TENANT : undefined);
    const scopeValue: string | null | undefined =
      query?.scopeValue ||
      query?.environment ||
      query?.tenantId ||
      (scopeType === ConfigScopeType.GLOBAL ? null : undefined);

    const cacheKey = this.buildCacheKey('all', scopeType, scopeValue);
    const client = this.redis.client;
    if (client) {
      try {
        const cached = await client.get(cacheKey);
        if (cached) {
          this.logger.debug('Cache hit for all configurations');
          return JSON.parse(cached);
        }
      } catch (err) {
        this.logger.warn(`Redis get failed, falling back to DB: ${err}`);
      }
    }

    // Query with scope filter
    let sql = 'SELECT * FROM v_policy_configurations_latest';
    const params: any[] = [];
    const conditions: string[] = [];

    if (scopeType) {
      conditions.push('scope_type = $' + (params.length + 1));
      params.push(scopeType);
    }

    if (scopeValue !== undefined) {
      conditions.push('scope_value = $' + (params.length + 1));
      params.push(scopeValue);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY config_key';

    const configs = await this.configRepository.query(sql, params);

    const result = configs.map(this.entityToDto);

    if (client) {
      try {
        await client.setEx(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(result));
      } catch (err) {
        this.logger.warn(`Redis set failed, serving without cache: ${err}`);
      }
    }

    return result;
  }

  /**
   * Get effective configuration value with scope fallback.
   * Priority: specific scope -> environment -> global.
   */
  async getEffective(
    configKey: string,
    environment?: string,
    tenantId?: string,
  ): Promise<ConfigurationResponseDto | null> {
    const cacheKey = this.buildCacheKey(
      `effective:${configKey}`,
      undefined,
      undefined,
    );
    const client = this.redis.client;

    // Try cache first
    if (client) {
      try {
        const cached = await client.get(cacheKey);
        if (cached) {
          this.logger.debug(
            `Cache hit for effective config: ${configKey} (${environment}/${tenantId})`,
          );
          return JSON.parse(cached);
        }
      } catch (err) {
        this.logger.warn(
          `Redis get failed for ${configKey}, falling back to DB: ${err}`,
        );
      }
    }

    // Query DB with scope fallback using function
    const configs = await this.configRepository.query(
      'SELECT * FROM get_effective_config_value($1, $2, $3)',
      [configKey, environment || null, tenantId || null],
    );

    if (!configs || configs.length === 0) {
      return null;
    }

    const result = this.entityToDto(configs[0]);

    // Cache the effective value
    if (client) {
      try {
        await client.setEx(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(result));
      } catch (err) {
        this.logger.warn(
          `Redis set failed for ${configKey}, serving without cache: ${err}`,
        );
      }
    }

    return result;
  }

  /**
   * Get a single configuration by key with optional scope filter.
   * Note: use getEffective() for automatic scope fallback.
   */
  async getByKey(
    configKey: string,
    scopeType?: ConfigScopeType,
    scopeValue?: string | null,
  ): Promise<ConfigurationResponseDto | null> {
    const cacheKey = this.buildCacheKey(`key:${configKey}`, scopeType, scopeValue);
    const client = this.redis.client;

    // Try cache first
    if (client) {
      try {
        const cached = await client.get(cacheKey);
        if (cached) {
          this.logger.debug(`Cache hit for config key: ${configKey}`);
          return JSON.parse(cached);
        }
      } catch (err) {
        this.logger.warn(
          `Redis get failed for ${configKey}, falling back to DB: ${err}`,
        );
      }
    }

    // Query DB with optional scope filter
    let sql = 'SELECT * FROM v_policy_configurations_latest WHERE config_key = $1';
    const params: any[] = [configKey];

    if (scopeType) {
      sql += ' AND scope_type = $2';
      params.push(scopeType);
    }

    if (scopeValue !== undefined) {
      sql += ' AND scope_value = $' + (params.length + 1);
      params.push(scopeValue);
    }

    const config = await this.configRepository.query(sql, params);

    if (!config || config.length === 0) {
      return null;
    }

    const result = this.entityToDto(config[0]);

    // Cache the result
    if (client) {
      try {
        await client.setEx(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(result));
      } catch (err) {
        this.logger.warn(
          `Redis set failed for ${configKey}, serving without cache: ${err}`,
        );
      }
    }

    return result;
  }

  /**
   * Get configuration history for a specific key and scope.
   */
  async getHistory(
    configKey: string,
    scopeType: ConfigScopeType = ConfigScopeType.GLOBAL,
    scopeValue?: string | null,
  ): Promise<ConfigurationHistoryItemDto[]> {
    const history = await this.configRepository.query(
      'SELECT * FROM get_config_history($1, $2, $3)',
      [configKey, scopeType, scopeValue || null],
    );

    return history.map(this.entityToHistoryDto);
  }

  /**
   * Create a new configuration (CFG-2/CFG-3).
   * Supports scoping and sensitive key approval flow.
   */
  async create(
    dto: CreateConfigurationDto,
    operatorId: string,
  ): Promise<ConfigurationResponseDto> {
    // Determine scope type and value
    const scopeType =
      dto.scopeType ||
      (dto.scopeValue ? ConfigScopeType.TENANT : ConfigScopeType.GLOBAL);
    const scopeValue = dto.scopeValue || null;

    // Validate sensitive keys require approval
    const isSensitive = dto.isSensitive ?? SENSITIVE_KEYS_PATTERN.test(dto.configKey);

    if (isSensitive && !dto.approveReason) {
      throw new Error(
        `Config key '${dto.configKey}' is sensitive and requires approve_reason`,
      );
    }

    const id = uuidv4();
    const now = new Date();

    // Get next version number for this key/scope combination
    const versionResult = await this.configRepository.query(
      `SELECT COALESCE(MAX(entity_version), 0) + 1 as next_version
       FROM policy_configurations
       WHERE config_key = $1 AND scope_type = $2 AND scope_value = $3`,
      [dto.configKey, scopeType, scopeValue],
    );
    const nextVersion = versionResult[0]?.next_version || 1;

    const entity = this.configRepository.create({
      id,
      configKey: dto.configKey,
      configValue: dto.configValue,
      isSensitive,
      entityVersion: nextVersion,
      createdAt: now,
      updatedAt: now,
      updatedBy: operatorId,
      // Note: scopeType and scopeValue will be added to entity after migration
      // For now, we'll insert directly via raw SQL
    });

    // Insert with scope columns (raw query to handle new columns)
    await this.configRepository.query(
      `INSERT INTO policy_configurations
       (id, config_key, config_value, is_sensitive, entity_version,
        created_at, updated_at, updated_by, scope_type, scope_value, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)`,
      [
        id,
        dto.configKey,
        dto.configValue,
        isSensitive,
        nextVersion,
        now,
        now,
        operatorId,
        scopeType,
        scopeValue,
      ],
    );

    // Invalidate cache
    await this.invalidateCache(dto.configKey, scopeType, scopeValue);

    // Audit log
    await this.auditClient.appendEntry({
      action: 'CONFIG_CREATED',
      resourceType: 'policy_configuration',
      resourceId: id,
      actor: operatorId,
      payload: {
        configKey: dto.configKey,
        isSensitive,
        scopeType,
        scopeValue,
        approveReason: dto.approveReason,
      },
      correlationId: uuidv4(),
    });

    this.logger.log(
      `Configuration created: ${dto.configKey} [${scopeType}:${scopeValue || 'global'}] v${nextVersion} by ${operatorId}`,
    );

    return this.getByKey(dto.configKey, scopeType, scopeValue) as Promise<ConfigurationResponseDto>;
  }

  /**
   * Update an existing configuration (creates new version).
   * Supports scoped updates.
   */
  async update(
    configKey: string,
    dto: Omit<CreateConfigurationDto, 'configKey'>,
    operatorId: string,
  ): Promise<ConfigurationResponseDto> {
    // Determine scope type and value (default to global for updates)
    const scopeType = dto.scopeType ?? ConfigScopeType.GLOBAL;
    const scopeValue = dto.scopeValue ?? null;

    const existing = await this.getByKey(configKey, scopeType, scopeValue);
    if (!existing) {
      throw new Error(
        `Configuration not found: ${configKey} [${scopeType}:${scopeValue || 'global'}]`,
      );
    }

    const isSensitive = dto.isSensitive ?? SENSITIVE_KEYS_PATTERN.test(configKey);
    if (isSensitive && !dto.approveReason) {
      throw new Error(
        `Config key '${configKey}' is sensitive and requires approve_reason`,
      );
    }

    const id = uuidv4();
    const now = new Date();
    const newVersion = existing.entityVersion + 1;

    // Insert new version with scope columns
    await this.configRepository.query(
      `INSERT INTO policy_configurations
       (id, config_key, config_value, is_sensitive, entity_version,
        created_at, updated_at, updated_by, scope_type, scope_value, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)`,
      [
        id,
        configKey,
        dto.configValue,
        isSensitive,
        newVersion,
        now,
        now,
        operatorId,
        scopeType,
        scopeValue,
      ],
    );

    // Invalidate cache
    await this.invalidateCache(configKey, scopeType, scopeValue);

    // Audit log
    await this.auditClient.appendEntry({
      action: 'CONFIG_UPDATED',
      resourceType: 'policy_configuration',
      resourceId: id,
      actor: operatorId,
      payload: {
        configKey,
        previousVersion: existing.entityVersion,
        newVersion,
        isSensitive,
        scopeType,
        scopeValue,
        approveReason: dto.approveReason,
      },
      correlationId: uuidv4(),
    });

    this.logger.log(
      `Configuration updated: ${configKey} [${scopeType}:${scopeValue || 'global'}] v${newVersion} by ${operatorId}`,
    );

    return this.getByKey(configKey, scopeType, scopeValue) as Promise<ConfigurationResponseDto>;
  }

  /**
   * Rollback configuration to a specific version (CFG-3).
   * Validates operator role and requires approval for sensitive keys.
   */
  async rollback(
    configKey: string,
    dto: RollbackConfigurationDto,
    operatorId: string,
  ): Promise<RollbackResponseDto> {
    const scopeType = dto.scopeType ?? ConfigScopeType.GLOBAL;
    const scopeValue = dto.scopeValue ?? null;

    // Check if key is sensitive
    const isSensitive = dto.isSensitive ?? SENSITIVE_KEYS_PATTERN.test(configKey);
    if (isSensitive && !dto.approveReason) {
      throw new Error(
        `Config key '${configKey}' is sensitive and requires approve_reason for rollback`,
      );
    }

    // Execute rollback function
    const result = await this.configRepository.query(
      'SELECT * FROM rollback_configuration($1, $2, $3, $4, $5)',
      [configKey, dto.toVersion, scopeType, scopeValue, operatorId],
    );

    if (!result || result.length === 0) {
      throw new Error(
        `Rollback failed for ${configKey} to version ${dto.toVersion}`,
      );
    }

    const rollbackId = result[0].rollback_configuration;

    // Invalidate cache
    await this.invalidateCache(configKey, scopeType, scopeValue);

    // Audit log
    await this.auditClient.appendEntry({
      action: 'CONFIG_ROLLBACK',
      resourceType: 'policy_configuration',
      resourceId: rollbackId,
      actor: operatorId,
      payload: {
        configKey,
        toVersion: dto.toVersion,
        scopeType,
        scopeValue,
        isSensitive,
        approveReason: dto.approveReason,
      },
      correlationId: uuidv4(),
    });

    this.logger.log(
      `Configuration rolled back: ${configKey} [${scopeType}:${scopeValue || 'global'}] to v${dto.toVersion} by ${operatorId}`,
    );

    // Get the rolled back configuration
    const rolledBackConfig = await this.getByKey(configKey, scopeType, scopeValue);

    return {
      rollbackId,
      configKey,
      toVersion: dto.toVersion,
      scopeType,
      scopeValue,
      rolledBackAt: new Date(),
    };
  }

  /**
   * Invalidate cache for a specific key and all-queries cache.
   * Supports scoped cache invalidation.
   */
  private async invalidateCache(
    configKey: string,
    scopeType?: ConfigScopeType,
    scopeValue?: string | null,
  ): Promise<void> {
    const client = this.redis.client;
    if (!client) {
      return;
    }

    try {
      // Build list of cache keys to invalidate
      const keysToDelete = [
        this.buildCacheKey(`key:${configKey}`, scopeType, scopeValue),
        this.buildCacheKey('all', scopeType, scopeValue),
      ];

      // Also invalidate effective config caches for all possible combinations
      keysToDelete.push(
        this.buildCacheKey(`effective:${configKey}`, undefined, undefined),
      );
      if (scopeType === ConfigScopeType.ENVIRONMENT) {
        keysToDelete.push(
          this.buildCacheKey(
            `effective:${configKey}`,
            scopeType,
            scopeValue || undefined,
          ),
        );
      }
      if (scopeType === ConfigScopeType.TENANT) {
        keysToDelete.push(
          this.buildCacheKey(
            `effective:${configKey}`,
            scopeType,
            scopeValue || undefined,
          ),
        );
      }

      // Delete all keys
      await Promise.all(keysToDelete.map((key) => client.del(key)));

      this.logger.debug(`Cache invalidated for: ${configKey}`);
    } catch (err) {
      this.logger.warn(`Redis cache invalidation failed for ${configKey}: ${err}`);
    }
  }

  /**
   * Build cache key with optional scope parameters.
   */
  private buildCacheKey(
    base: string,
    scopeType?: ConfigScopeType | null,
    scopeValue?: string | null | undefined,
  ): string {
    if (!scopeType) {
      return `arb:config:v1:${base}`;
    }
    return `arb:config:scope:${scopeType}:${scopeValue || 'global'}:${base}`;
  }

  private entityToDto(entity: any): ConfigurationResponseDto {
    return {
      id: entity.id,
      configKey: entity.config_key,
      configValue: entity.config_value,
      isSensitive: entity.is_sensitive,
      entityVersion: entity.entity_version,
      createdAt: entity.created_at,
      updatedAt: entity.updated_at,
      updatedBy: entity.updated_by,
      scopeType: entity.scope_type,
      scopeValue: entity.scope_value,
    };
  }

  private entityToHistoryDto(entity: any): ConfigurationHistoryItemDto {
    return {
      id: entity.id,
      configKey: entity.config_key,
      configValue: entity.config_value,
      isSensitive: entity.is_sensitive,
      entityVersion: entity.entity_version,
      createdAt: entity.created_at,
      updatedAt: entity.updated_at,
      updatedBy: entity.updated_by,
      isActive: entity.is_active,
    };
  }
}
