"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var ConfigurationsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigurationsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const uuid_1 = require("uuid");
const nest_platform_1 = require("@arbibot/nest-platform");
const persistence_1 = require("@arbibot/persistence");
const create_configuration_dto_1 = require("../dto/create-configuration.dto");
const redis_connection_1 = require("../redis/redis-connection");
const CACHE_TTL_SECONDS = 60;
const SENSITIVE_KEYS_PATTERN = /^(risk\..*|execution\..*|capital\..*)/;
let ConfigurationsService = ConfigurationsService_1 = class ConfigurationsService {
    redis;
    configRepository;
    auditClient;
    logger = new common_1.Logger(ConfigurationsService_1.name);
    constructor(redis, configRepository, auditClient) {
        this.redis = redis;
        this.configRepository = configRepository;
        this.auditClient = auditClient;
    }
    async getAll(query) {
        const scopeType = query?.scopeType ||
            (query?.environment ? create_configuration_dto_1.ConfigScopeType.ENVIRONMENT : undefined) ||
            (query?.tenantId ? create_configuration_dto_1.ConfigScopeType.TENANT : undefined);
        const scopeValue = query?.scopeValue ||
            query?.environment ||
            query?.tenantId ||
            (scopeType === create_configuration_dto_1.ConfigScopeType.GLOBAL ? null : undefined);
        const cacheKey = this.buildCacheKey('all', scopeType, scopeValue);
        const client = this.redis.client;
        if (client) {
            try {
                const cached = await client.get(cacheKey);
                if (cached) {
                    this.logger.debug('Cache hit for all configurations');
                    return JSON.parse(cached);
                }
            }
            catch (err) {
                this.logger.warn(`Redis get failed, falling back to DB: ${err}`);
            }
        }
        let sql = 'SELECT * FROM v_policy_configurations_latest';
        const params = [];
        const conditions = [];
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
            }
            catch (err) {
                this.logger.warn(`Redis set failed, serving without cache: ${err}`);
            }
        }
        return result;
    }
    async getEffective(configKey, environment, tenantId) {
        const cacheKey = this.buildCacheKey(`effective:${configKey}`, undefined, undefined);
        const client = this.redis.client;
        if (client) {
            try {
                const cached = await client.get(cacheKey);
                if (cached) {
                    this.logger.debug(`Cache hit for effective config: ${configKey} (${environment}/${tenantId})`);
                    return JSON.parse(cached);
                }
            }
            catch (err) {
                this.logger.warn(`Redis get failed for ${configKey}, falling back to DB: ${err}`);
            }
        }
        const configs = await this.configRepository.query('SELECT * FROM get_effective_config_value($1, $2, $3)', [configKey, environment || null, tenantId || null]);
        if (!configs || configs.length === 0) {
            return null;
        }
        const result = this.entityToDto(configs[0]);
        if (client) {
            try {
                await client.setEx(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(result));
            }
            catch (err) {
                this.logger.warn(`Redis set failed for ${configKey}, serving without cache: ${err}`);
            }
        }
        return result;
    }
    async getByKey(configKey, scopeType, scopeValue) {
        const cacheKey = this.buildCacheKey(`key:${configKey}`, scopeType, scopeValue);
        const client = this.redis.client;
        if (client) {
            try {
                const cached = await client.get(cacheKey);
                if (cached) {
                    this.logger.debug(`Cache hit for config key: ${configKey}`);
                    return JSON.parse(cached);
                }
            }
            catch (err) {
                this.logger.warn(`Redis get failed for ${configKey}, falling back to DB: ${err}`);
            }
        }
        let sql = 'SELECT * FROM v_policy_configurations_latest WHERE config_key = $1';
        const params = [configKey];
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
        if (client) {
            try {
                await client.setEx(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(result));
            }
            catch (err) {
                this.logger.warn(`Redis set failed for ${configKey}, serving without cache: ${err}`);
            }
        }
        return result;
    }
    async getHistory(configKey, scopeType = create_configuration_dto_1.ConfigScopeType.GLOBAL, scopeValue) {
        const history = await this.configRepository.query('SELECT * FROM get_config_history($1, $2, $3)', [configKey, scopeType, scopeValue || null]);
        return history.map(this.entityToHistoryDto);
    }
    async create(dto, operatorId) {
        const scopeType = dto.scopeType ||
            (dto.scopeValue ? create_configuration_dto_1.ConfigScopeType.TENANT : create_configuration_dto_1.ConfigScopeType.GLOBAL);
        const scopeValue = dto.scopeValue || null;
        const isSensitive = dto.isSensitive ?? SENSITIVE_KEYS_PATTERN.test(dto.configKey);
        if (isSensitive && !dto.approveReason) {
            throw new Error(`Config key '${dto.configKey}' is sensitive and requires approve_reason`);
        }
        const id = (0, uuid_1.v4)();
        const now = new Date();
        const versionResult = await this.configRepository.query(`SELECT COALESCE(MAX(entity_version), 0) + 1 as next_version
       FROM policy_configurations
       WHERE config_key = $1 AND scope_type = $2 AND scope_value = $3`, [dto.configKey, scopeType, scopeValue]);
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
        });
        await this.configRepository.query(`INSERT INTO policy_configurations
       (id, config_key, config_value, is_sensitive, entity_version,
        created_at, updated_at, updated_by, scope_type, scope_value, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)`, [
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
        ]);
        await this.invalidateCache(dto.configKey, scopeType, scopeValue);
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
            correlationId: (0, uuid_1.v4)(),
        });
        this.logger.log(`Configuration created: ${dto.configKey} [${scopeType}:${scopeValue || 'global'}] v${nextVersion} by ${operatorId}`);
        return this.getByKey(dto.configKey, scopeType, scopeValue);
    }
    async update(configKey, dto, operatorId) {
        const scopeType = dto.scopeType ?? create_configuration_dto_1.ConfigScopeType.GLOBAL;
        const scopeValue = dto.scopeValue ?? null;
        const existing = await this.getByKey(configKey, scopeType, scopeValue);
        if (!existing) {
            throw new Error(`Configuration not found: ${configKey} [${scopeType}:${scopeValue || 'global'}]`);
        }
        const isSensitive = dto.isSensitive ?? SENSITIVE_KEYS_PATTERN.test(configKey);
        if (isSensitive && !dto.approveReason) {
            throw new Error(`Config key '${configKey}' is sensitive and requires approve_reason`);
        }
        const id = (0, uuid_1.v4)();
        const now = new Date();
        const newVersion = existing.entityVersion + 1;
        await this.configRepository.query(`INSERT INTO policy_configurations
       (id, config_key, config_value, is_sensitive, entity_version,
        created_at, updated_at, updated_by, scope_type, scope_value, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)`, [
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
        ]);
        await this.invalidateCache(configKey, scopeType, scopeValue);
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
            correlationId: (0, uuid_1.v4)(),
        });
        this.logger.log(`Configuration updated: ${configKey} [${scopeType}:${scopeValue || 'global'}] v${newVersion} by ${operatorId}`);
        return this.getByKey(configKey, scopeType, scopeValue);
    }
    async rollback(configKey, dto, operatorId) {
        const scopeType = dto.scopeType ?? create_configuration_dto_1.ConfigScopeType.GLOBAL;
        const scopeValue = dto.scopeValue ?? null;
        const isSensitive = dto.isSensitive ?? SENSITIVE_KEYS_PATTERN.test(configKey);
        if (isSensitive && !dto.approveReason) {
            throw new Error(`Config key '${configKey}' is sensitive and requires approve_reason for rollback`);
        }
        const result = await this.configRepository.query('SELECT * FROM rollback_configuration($1, $2, $3, $4, $5)', [configKey, dto.toVersion, scopeType, scopeValue, operatorId]);
        if (!result || result.length === 0) {
            throw new Error(`Rollback failed for ${configKey} to version ${dto.toVersion}`);
        }
        const rollbackId = result[0].rollback_configuration;
        await this.invalidateCache(configKey, scopeType, scopeValue);
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
            correlationId: (0, uuid_1.v4)(),
        });
        this.logger.log(`Configuration rolled back: ${configKey} [${scopeType}:${scopeValue || 'global'}] to v${dto.toVersion} by ${operatorId}`);
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
    async invalidateCache(configKey, scopeType, scopeValue) {
        const client = this.redis.client;
        if (!client) {
            return;
        }
        try {
            const keysToDelete = [
                this.buildCacheKey(`key:${configKey}`, scopeType, scopeValue),
                this.buildCacheKey('all', scopeType, scopeValue),
            ];
            keysToDelete.push(this.buildCacheKey(`effective:${configKey}`, undefined, undefined));
            if (scopeType === create_configuration_dto_1.ConfigScopeType.ENVIRONMENT) {
                keysToDelete.push(this.buildCacheKey(`effective:${configKey}`, scopeType, scopeValue || undefined));
            }
            if (scopeType === create_configuration_dto_1.ConfigScopeType.TENANT) {
                keysToDelete.push(this.buildCacheKey(`effective:${configKey}`, scopeType, scopeValue || undefined));
            }
            await Promise.all(keysToDelete.map((key) => client.del(key)));
            this.logger.debug(`Cache invalidated for: ${configKey}`);
        }
        catch (err) {
            this.logger.warn(`Redis cache invalidation failed for ${configKey}: ${err}`);
        }
    }
    buildCacheKey(base, scopeType, scopeValue) {
        if (!scopeType) {
            return `arb:config:v1:${base}`;
        }
        return `arb:config:scope:${scopeType}:${scopeValue || 'global'}:${base}`;
    }
    entityToDto(entity) {
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
    entityToHistoryDto(entity) {
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
};
exports.ConfigurationsService = ConfigurationsService;
exports.ConfigurationsService = ConfigurationsService = ConfigurationsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, typeorm_1.InjectRepository)(persistence_1.PolicyConfigurationEntity)),
    __metadata("design:paramtypes", [redis_connection_1.RedisConnection,
        typeorm_2.Repository,
        nest_platform_1.AuditClientService])
], ConfigurationsService);
//# sourceMappingURL=configurations.service.js.map