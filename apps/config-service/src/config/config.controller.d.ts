import { FastifyReply } from 'fastify';
import { ConfigurationsService } from './configurations.service';
import { CreateConfigurationDto, QueryConfigurationsDto, ConfigScopeType } from '../dto/create-configuration.dto';
import { ConfigurationResponseDto, ConfigurationHistoryItemDto } from '../dto/configuration-response.dto';
import { RollbackConfigurationDto } from '../dto/rollback-configuration.dto';
import { RollbackResponseDto } from '../dto/configuration-response.dto';
export declare class ConfigController {
    private readonly configurationsService;
    constructor(configurationsService: ConfigurationsService);
    getAll(query: QueryConfigurationsDto): Promise<ConfigurationResponseDto[]>;
    getEffective(configKey: string, environment?: string, tenantId?: string): Promise<ConfigurationResponseDto>;
    getByKey(configKey: string, scopeType?: ConfigScopeType, scopeValue?: string): Promise<ConfigurationResponseDto>;
    getHistory(configKey: string, scopeType?: ConfigScopeType, scopeValue?: string): Promise<ConfigurationHistoryItemDto[]>;
    create(dto: CreateConfigurationDto, operatorId: string, reply: FastifyReply): Promise<ConfigurationResponseDto | void>;
    update(configKey: string, dto: Omit<CreateConfigurationDto, 'configKey'>, operatorId: string, reply: FastifyReply): Promise<ConfigurationResponseDto | void>;
    rollback(configKey: string, dto: RollbackConfigurationDto, operatorId: string, reply: FastifyReply): Promise<RollbackResponseDto | void>;
}
