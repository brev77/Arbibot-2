import { Repository } from 'typeorm';
import { AuditClientService } from '@arbibot/nest-platform';
import { PolicyConfigurationEntity } from '@arbibot/persistence';
import { CreateConfigurationDto, QueryConfigurationsDto, ConfigScopeType } from '../dto/create-configuration.dto';
import { ConfigurationResponseDto, ConfigurationHistoryItemDto, RollbackResponseDto } from '../dto/configuration-response.dto';
import { RollbackConfigurationDto } from '../dto/rollback-configuration.dto';
import { RedisConnection } from '../redis/redis-connection';
export declare class ConfigurationsService {
    private readonly redis;
    private readonly configRepository;
    private readonly auditClient;
    private readonly logger;
    constructor(redis: RedisConnection, configRepository: Repository<PolicyConfigurationEntity>, auditClient: AuditClientService);
    getAll(query?: QueryConfigurationsDto): Promise<ConfigurationResponseDto[]>;
    getEffective(configKey: string, environment?: string, tenantId?: string): Promise<ConfigurationResponseDto | null>;
    getByKey(configKey: string, scopeType?: ConfigScopeType, scopeValue?: string | null): Promise<ConfigurationResponseDto | null>;
    getHistory(configKey: string, scopeType?: ConfigScopeType, scopeValue?: string | null): Promise<ConfigurationHistoryItemDto[]>;
    create(dto: CreateConfigurationDto, operatorId: string): Promise<ConfigurationResponseDto>;
    update(configKey: string, dto: Omit<CreateConfigurationDto, 'configKey'>, operatorId: string): Promise<ConfigurationResponseDto>;
    rollback(configKey: string, dto: RollbackConfigurationDto, operatorId: string): Promise<RollbackResponseDto>;
    private invalidateCache;
    private buildCacheKey;
    private entityToDto;
    private entityToHistoryDto;
}
