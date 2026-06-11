import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { AuditClientService } from '@arbibot/nest-platform';
import { PolicyConfigurationEntity } from '@arbibot/persistence';

import {
  CreateConfigurationDto,
  QueryConfigurationsDto,
  ConfigScopeType,
  ConfigurationStatus,
} from '../dto/create-configuration.dto';
import { PromoteConfigurationDto } from '../dto/promote-configuration.dto';
import { UpdateConfigurationStatusDto } from '../dto/update-configuration-status.dto';
import {
  ConfigurationResponseDto,
  ConfigurationHistoryItemDto,
  RollbackResponseDto,
} from '../dto/configuration-response.dto';
import { RollbackConfigurationDto } from '../dto/rollback-configuration.dto';
import { RedisConnection } from '../redis/redis-connection';

const CACHE_TTL_SECONDS = 60;
const SENSITIVE_KEYS_PATTERN = /^(risk\..*|execution\..*|capital\..*)/;

function formatUnknownError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/** Narrow DB scalars before string coercion (satisfies no-base-to-string). */
function asDbString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  throw new TypeError('Expected string-like DB scalar');
}

function asDbNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return asDbString(value);
}

type SqlParam = string | number | boolean | Date | null | ConfigScopeType;

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
        this.logger.warn(
          `Redis get failed, falling back to DB: ${formatUnknownError(err)}`,
        );
      }
    }

    // Query with scope filter
    let sql = 'SELECT * FROM v_policy_configurations_latest';
    const params: SqlParam[] = [];
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

    const result = configs.map((row: Record<string, unknown>) =>
      this.entityToDto(row),
    );

    if (client) {
      try {
        await client.setEx(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(result));
      } catch (err) {
        this.logger.warn(
          `Redis set failed, serving without cache: ${formatUnknownError(err)}`,
        );
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
          `Redis get failed for ${configKey}, falling back to DB: ${formatUnknownError(err)}`,
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
          `Redis set failed for ${configKey}, serving without cache: ${formatUnknownError(err)}`,
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
          `Redis get failed for ${configKey}, falling back to DB: ${formatUnknownError(err)}`,
        );
      }
    }

    // Query DB with optional scope filter
    let sql = 'SELECT * FROM v_policy_configurations_latest WHERE config_key = $1';
    const params: SqlParam[] = [configKey];

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
          `Redis set failed for ${configKey}, serving without cache: ${formatUnknownError(err)}`,
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

    return history.map((row: Record<string, unknown>) =>
      this.entityToHistoryDto(row),
    );
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
      throw new BadRequestException(
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

    const effectiveStatus = dto.status ?? ConfigurationStatus.ACTIVE;
    const isActiveRow = effectiveStatus === ConfigurationStatus.ACTIVE;

    // Insert with scope columns (raw query to handle new columns)
    await this.configRepository.query(
      `INSERT INTO policy_configurations
       (id, config_key, config_value, is_sensitive, entity_version,
        created_at, updated_at, updated_by, scope_type, scope_value, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
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
        isActiveRow,
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
        status: effectiveStatus,
      },
      correlationId: uuidv4(),
    });

    this.logger.log(
      `Configuration created: ${dto.configKey} [${scopeType}:${scopeValue || 'global'}] v${nextVersion} by ${operatorId}`,
    );

    if (!isActiveRow) {
      return {
        id,
        configKey: dto.configKey,
        configValue: dto.configValue,
        isSensitive,
        entityVersion: nextVersion,
        createdAt: now,
        updatedAt: now,
        updatedBy: operatorId,
        scopeType,
        scopeValue,
      };
    }

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
      throw new NotFoundException(
        `Configuration not found: ${configKey} [${scopeType}:${scopeValue || 'global'}]`,
      );
    }

    const isSensitive = dto.isSensitive ?? SENSITIVE_KEYS_PATTERN.test(configKey);
    if (isSensitive && !dto.approveReason) {
      throw new BadRequestException(
        `Config key '${configKey}' is sensitive and requires approve_reason`,
      );
    }

    const id = uuidv4();
    const now = new Date();
    const newVersion = existing.entityVersion + 1;

    const effectiveStatus = dto.status ?? ConfigurationStatus.ACTIVE;
    const isActiveRow = effectiveStatus === ConfigurationStatus.ACTIVE;

    // Insert new version with scope columns
    await this.configRepository.query(
      `INSERT INTO policy_configurations
       (id, config_key, config_value, is_sensitive, entity_version,
        created_at, updated_at, updated_by, scope_type, scope_value, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
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
        isActiveRow,
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
        status: effectiveStatus,
      },
      correlationId: uuidv4(),
    });

    this.logger.log(
      `Configuration updated: ${configKey} [${scopeType}:${scopeValue || 'global'}] v${newVersion} by ${operatorId}`,
    );

    if (!isActiveRow) {
      return {
        id,
        configKey,
        configValue: dto.configValue,
        isSensitive,
        entityVersion: newVersion,
        createdAt: now,
        updatedAt: now,
        updatedBy: operatorId,
        scopeType,
        scopeValue,
      };
    }

    return this.getByKey(configKey, scopeType, scopeValue) as Promise<ConfigurationResponseDto>;
  }

  /**
   * Promote configuration from one scope to another (CFG-3 staged rollout).
   * Deactivates the source scope row and creates a new active row in the target scope.
   */
  async promote(
    configKey: string,
    dto: PromoteConfigurationDto,
    operatorId: string,
  ): Promise<ConfigurationResponseDto> {
    const fromScopeType = dto.fromScopeType;
    const fromScopeValue = dto.fromScopeValue ?? null;
    const toScopeType = dto.toScopeType;
    const toScopeValue = dto.toScopeValue ?? null;

    if (
      fromScopeType === toScopeType &&
      fromScopeValue === toScopeValue
    ) {
      throw new BadRequestException(
        'Promotion requires different source and target scopes',
      );
    }

    if (SENSITIVE_KEYS_PATTERN.test(configKey) && !dto.approveReason) {
      throw new BadRequestException(
        `Config key '${configKey}' is sensitive and requires approve_reason for promotion`,
      );
    }

    const idempotencyKey = dto.idempotencyKey?.trim();
    const client = this.redis.client;
    if (idempotencyKey && client) {
      try {
        const cached = await client.get(
          `arb:config:v1:promote:idemp:${idempotencyKey}`,
        );
        if (cached) {
          return JSON.parse(cached) as ConfigurationResponseDto;
        }
      } catch (err) {
        this.logger.warn(
          `Redis idempotency get failed: ${formatUnknownError(err)}`,
        );
      }
    }

    const source = await this.getByKey(
      configKey,
      fromScopeType,
      fromScopeValue,
    );
    if (!source) {
      throw new NotFoundException(
        `Source configuration not found: ${configKey} [${fromScopeType}:${fromScopeValue ?? 'global'}]`,
      );
    }

    const targetExisting = await this.getByKey(
      configKey,
      toScopeType,
      toScopeValue,
    );
    if (targetExisting) {
      throw new ConflictException(
        `Target scope already has an active configuration for '${configKey}'. Update or rollback the target scope first.`,
      );
    }

    const versionResult = await this.configRepository.query(
      `SELECT COALESCE(MAX(entity_version), 0) + 1 as next_version
       FROM policy_configurations
       WHERE config_key = $1 AND scope_type = $2 AND scope_value IS NOT DISTINCT FROM $3`,
      [configKey, toScopeType, toScopeValue],
    );
    const nextVersion = versionResult[0]?.next_version || 1;

    const id = uuidv4();
    const now = new Date();

    await this.configRepository.query(
      `INSERT INTO policy_configurations
       (id, config_key, config_value, is_sensitive, entity_version,
        created_at, updated_at, updated_by, scope_type, scope_value, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)`,
      [
        id,
        configKey,
        source.configValue,
        source.isSensitive,
        nextVersion,
        now,
        now,
        operatorId,
        toScopeType,
        toScopeValue,
      ],
    );

    await this.configRepository.query(
      `UPDATE policy_configurations
       SET is_active = false, updated_at = $1, updated_by = $2
       WHERE id = $3`,
      [now, operatorId, source.id],
    );

    await this.invalidateCache(configKey, fromScopeType, fromScopeValue);
    await this.invalidateCache(configKey, toScopeType, toScopeValue);

    await this.auditClient.appendEntry({
      action: 'CONFIG_PROMOTED',
      resourceType: 'policy_configuration',
      resourceId: id,
      actor: operatorId,
      payload: {
        configKey,
        fromScopeType,
        fromScopeValue,
        toScopeType,
        toScopeValue,
        sourceVersion: source.entityVersion,
        targetVersion: nextVersion,
        approveReason: dto.approveReason,
      },
      correlationId: uuidv4(),
    });

    this.logger.log(
      `Configuration promoted: ${configKey} ${fromScopeType}:${fromScopeValue ?? 'global'} → ${toScopeType}:${toScopeValue ?? 'global'} by ${operatorId}`,
    );

    const result = (await this.getByKey(
      configKey,
      toScopeType,
      toScopeValue,
    )) as ConfigurationResponseDto;

    if (idempotencyKey && client) {
      try {
        await client.setEx(
          `arb:config:v1:promote:idemp:${idempotencyKey}`,
          86400,
          JSON.stringify(result),
        );
      } catch (err) {
        this.logger.warn(
          `Redis idempotency set failed: ${formatUnknownError(err)}`,
        );
      }
    }

    return result;
  }

  /**
   * Activate the latest draft row for a scope (CFG-3).
   */
  async updateStatus(
    configKey: string,
    dto: UpdateConfigurationStatusDto,
    operatorId: string,
  ): Promise<ConfigurationResponseDto> {
    if (dto.status !== ConfigurationStatus.ACTIVE) {
      throw new BadRequestException(
        'Only activation (status=active) is supported via this endpoint; create drafts with POST.',
      );
    }

    const scopeType = dto.scopeType ?? ConfigScopeType.GLOBAL;
    const scopeValue = dto.scopeValue ?? null;

    if (SENSITIVE_KEYS_PATTERN.test(configKey) && !dto.approveReason) {
      throw new BadRequestException(
        `Config key '${configKey}' is sensitive and requires approve_reason for activation`,
      );
    }

    const latestRows = await this.configRepository.query(
      `SELECT *
       FROM policy_configurations
       WHERE config_key = $1
         AND scope_type = $2
         AND scope_value IS NOT DISTINCT FROM $3
       ORDER BY entity_version DESC
       LIMIT 1`,
      [configKey, scopeType, scopeValue],
    );

    if (!latestRows || latestRows.length === 0) {
      throw new NotFoundException(
        `Configuration not found: ${configKey} [${scopeType}:${scopeValue ?? 'global'}]`,
      );
    }

    const latest = latestRows[0] as Record<string, unknown>;
    if (latest.is_active === true) {
      return this.getByKey(configKey, scopeType, scopeValue) as Promise<ConfigurationResponseDto>;
    }

    const draftValue = asDbString(latest.config_value);
    const isSensitive = Boolean(latest.is_sensitive);
    const now = new Date();

    await this.configRepository.query(
      `UPDATE policy_configurations
       SET is_active = false, updated_at = $1, updated_by = $2
       WHERE config_key = $3
         AND scope_type = $4
         AND scope_value IS NOT DISTINCT FROM $5
         AND is_active = true`,
      [now, operatorId, configKey, scopeType, scopeValue],
    );

    const versionResult = await this.configRepository.query(
      `SELECT COALESCE(MAX(entity_version), 0) + 1 as next_version
       FROM policy_configurations
       WHERE config_key = $1 AND scope_type = $2 AND scope_value IS NOT DISTINCT FROM $3`,
      [configKey, scopeType, scopeValue],
    );
    const nextVersion = versionResult[0]?.next_version || 1;

    const id = uuidv4();
    await this.configRepository.query(
      `INSERT INTO policy_configurations
       (id, config_key, config_value, is_sensitive, entity_version,
        created_at, updated_at, updated_by, scope_type, scope_value, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)`,
      [
        id,
        configKey,
        draftValue,
        isSensitive,
        nextVersion,
        now,
        now,
        operatorId,
        scopeType,
        scopeValue,
      ],
    );

    await this.invalidateCache(configKey, scopeType, scopeValue);

    await this.auditClient.appendEntry({
      action: 'CONFIG_STATUS_ACTIVATED',
      resourceType: 'policy_configuration',
      resourceId: id,
      actor: operatorId,
      payload: {
        configKey,
        scopeType,
        scopeValue,
        previousDraftVersion: Number(latest.entity_version),
        newVersion: nextVersion,
        approveReason: dto.approveReason,
      },
      correlationId: uuidv4(),
    });

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
      throw new BadRequestException(
        `Config key '${configKey}' is sensitive and requires approve_reason for rollback`,
      );
    }

    // Execute rollback function
    const result = await this.configRepository.query(
      'SELECT * FROM rollback_configuration($1, $2, $3, $4, $5)',
      [configKey, dto.toVersion, operatorId, scopeType, scopeValue],
    );

    if (!result || result.length === 0) {
      throw new NotFoundException(
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

    await this.getByKey(configKey, scopeType, scopeValue);

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
      this.logger.warn(
        `Redis cache invalidation failed for ${configKey}: ${formatUnknownError(err)}`,
      );
    }
  }

  /**
   * Build cache key with optional scope parameters.
   */
  private buildCacheKey(
    base: string,
    scopeType?: ConfigScopeType | null,
    scopeValue?: string | null,
  ): string {
    if (!scopeType) {
      return `arb:config:v1:${base}`;
    }
    return `arb:config:scope:${scopeType}:${scopeValue || 'global'}:${base}`;
  }

  private entityToDto(row: Record<string, unknown>): ConfigurationResponseDto {
    return {
      id: asDbString(row.id),
      configKey: asDbString(row.config_key),
      configValue: asDbString(row.config_value),
      isSensitive: Boolean(row.is_sensitive),
      entityVersion: Number(row.entity_version),
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
      updatedBy: asDbNullableString(row.updated_by),
      scopeType: row.scope_type as ConfigurationResponseDto['scopeType'],
      scopeValue: asDbNullableString(row.scope_value),
    };
  }

  private entityToHistoryDto(
    row: Record<string, unknown>,
  ): ConfigurationHistoryItemDto {
    return {
      id: asDbString(row.id),
      configKey: asDbString(row.config_key),
      configValue: asDbString(row.config_value),
      isSensitive: Boolean(row.is_sensitive),
      entityVersion: Number(row.entity_version),
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
      updatedBy: asDbNullableString(row.updated_by),
      isActive: Boolean(row.is_active),
    };
  }
}
