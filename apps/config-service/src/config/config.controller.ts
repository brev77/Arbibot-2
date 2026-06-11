import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';

import { ConfigurationsService } from './configurations.service';
import {
  CreateConfigurationDto,
  QueryConfigurationsDto,
  ConfigScopeType,
} from '../dto/create-configuration.dto';
import {
  ConfigurationResponseDto,
  ConfigurationHistoryItemDto,
} from '../dto/configuration-response.dto';
import { RollbackConfigurationDto } from '../dto/rollback-configuration.dto';
import { RollbackResponseDto } from '../dto/configuration-response.dto';
import { PromoteConfigurationDto } from '../dto/promote-configuration.dto';
import { UpdateConfigurationStatusDto } from '../dto/update-configuration-status.dto';

@Controller('policy')
export class ConfigController {
  constructor(private readonly configurationsService: ConfigurationsService) {}

  /**
   * Get all configurations with optional scope filtering (CFG-3).
   * Query params: scopeType (global|environment|tenant), scopeValue
   */
  @Get('configurations')
  async getAll(
    @Query() query: QueryConfigurationsDto,
  ): Promise<ConfigurationResponseDto[]> {
    return this.configurationsService.getAll(query);
  }

  /**
   * Get effective configuration value with automatic scope fallback (CFG-3).
   * Priority: specific scope -> environment -> global.
   * Query params: environment, tenantId
   */
  @Get('configurations/:configKey/effective')
  async getEffective(
    @Param('configKey') configKey: string,
    @Query('environment') environment?: string,
    @Query('tenantId') tenantId?: string,
  ): Promise<ConfigurationResponseDto> {
    const config = await this.configurationsService.getEffective(
      configKey,
      environment,
      tenantId,
    );
    if (!config) {
      throw new NotFoundException(`Configuration not found: ${configKey}`);
    }
    return config;
  }

  /**
   * Get a single configuration by key with optional scope filter (CFG-3).
   * Query params: scopeType, scopeValue
   */
  @Get('configurations/:configKey')
  async getByKey(
    @Param('configKey') configKey: string,
    @Query('scopeType') scopeType?: ConfigScopeType,
    @Query('scopeValue') scopeValue?: string,
  ): Promise<ConfigurationResponseDto> {
    const config = await this.configurationsService.getByKey(
      configKey,
      scopeType,
      scopeValue || null,
    );
    if (!config) {
      throw new NotFoundException(`Configuration not found: ${configKey}`);
    }
    return config;
  }

  /**
   * Get configuration history for a specific key and scope (CFG-3).
   * Query params: scopeType, scopeValue (defaults to global)
   */
  @Get('configurations/:configKey/history')
  async getHistory(
    @Param('configKey') configKey: string,
    @Query('scopeType') scopeType?: ConfigScopeType,
    @Query('scopeValue') scopeValue?: string,
  ): Promise<ConfigurationHistoryItemDto[]> {
    return this.configurationsService.getHistory(
      configKey,
      scopeType || ConfigScopeType.GLOBAL,
      scopeValue || null,
    );
  }

  /**
   * Create a new configuration with optional scope (CFG-2/CFG-3).
   * Body: configKey, configValue, isSensitive, scopeType, scopeValue, approveReason
   * Header: operatorId (required for audit)
   */
  @Post('configurations')
  async create(
    @Body() dto: CreateConfigurationDto,
    @Body('operatorId') operatorId: string,
    reply: FastifyReply,
  ): Promise<ConfigurationResponseDto | void> {
    if (!operatorId) {
      reply.status(HttpStatus.BAD_REQUEST).send({ error: 'operatorId is required' });
      return;
    }
    return this.configurationsService.create(dto, operatorId);
  }

  /**
   * Update an existing configuration (creates new version) with optional scope (CFG-3).
   * Body: configValue, isSensitive, scopeType, scopeValue, approveReason
   * Header: operatorId (required for audit)
   */
  @Put('configurations/:configKey')
  async update(
    @Param('configKey') configKey: string,
    @Body() dto: Omit<CreateConfigurationDto, 'configKey'>,
    @Body('operatorId') operatorId: string,
    reply: FastifyReply,
  ): Promise<ConfigurationResponseDto | void> {
    if (!operatorId) {
      reply.status(HttpStatus.BAD_REQUEST).send({ error: 'operatorId is required' });
      return;
    }
    return this.configurationsService.update(configKey, dto, operatorId);
  }

  /**
   * Rollback configuration to a specific version (CFG-3).
   * Body: toVersion, scopeType, scopeValue, isSensitive, approveReason
   * Header: operatorId (required for audit)
   */
  @Post('configurations/:configKey/rollback')
  async rollback(
    @Param('configKey') configKey: string,
    @Body() dto: RollbackConfigurationDto,
    @Body('operatorId') operatorId: string,
    reply: FastifyReply,
  ): Promise<RollbackResponseDto | void> {
    if (!operatorId) {
      reply.status(HttpStatus.BAD_REQUEST).send({ error: 'operatorId is required' });
      return;
    }
    return this.configurationsService.rollback(configKey, dto, operatorId);
  }

  /**
   * Promote configuration from source scope to target scope (CFG-3).
   */
  @Post('configurations/:configKey/promote')
  async promote(
    @Param('configKey') configKey: string,
    @Body() dto: PromoteConfigurationDto,
    @Body('operatorId') operatorId: string,
    reply: FastifyReply,
  ): Promise<ConfigurationResponseDto | void> {
    if (!operatorId) {
      reply.status(HttpStatus.BAD_REQUEST).send({ error: 'operatorId is required' });
      return;
    }
    return this.configurationsService.promote(configKey, dto, operatorId);
  }

  /**
   * Activate latest draft row for a scope (CFG-3).
   */
  @Patch('configurations/:configKey/status')
  async updateStatus(
    @Param('configKey') configKey: string,
    @Body() dto: UpdateConfigurationStatusDto,
    @Body('operatorId') operatorId: string,
    reply: FastifyReply,
  ): Promise<ConfigurationResponseDto | void> {
    if (!operatorId) {
      reply.status(HttpStatus.BAD_REQUEST).send({ error: 'operatorId is required' });
      return;
    }
    return this.configurationsService.updateStatus(configKey, dto, operatorId);
  }
}
