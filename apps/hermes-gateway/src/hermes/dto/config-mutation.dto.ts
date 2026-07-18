import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { HermesOperatorMutationDto } from './operator-mutation.dto';

/** Config scope types — mirrors config-service `policy_config_scope_type` enum. */
export enum ConfigScopeType {
  GLOBAL = 'global',
  ENVIRONMENT = 'environment',
  TENANT = 'tenant',
}

/** Draft / active row status — mirrors config-service `ConfigurationStatus`. */
export enum ConfigurationStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
}

/**
 * PUT /hermes/v1/config/:configKey → config-service `PUT /policy/configurations/:configKey`.
 * Creates a new version (or new key) with the given value.
 */
export class ConfigUpdateDto extends HermesOperatorMutationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  configValue!: string;

  @IsOptional()
  @IsEnum(ConfigScopeType)
  scopeType?: ConfigScopeType;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  scopeValue?: string;

  @IsOptional()
  @IsEnum(ConfigurationStatus)
  status?: ConfigurationStatus;
}

/**
 * POST /hermes/v1/config/:configKey/rollback → config-service rollback to a prior version.
 */
export class ConfigRollbackDto extends HermesOperatorMutationDto {
  @IsInt()
  toVersion!: number;

  @IsOptional()
  @IsEnum(ConfigScopeType)
  scopeType?: ConfigScopeType;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  scopeValue?: string;
}

/**
 * POST /hermes/v1/config/:configKey/promote → config-service scope promotion.
 */
export class ConfigPromoteDto extends HermesOperatorMutationDto {
  @IsEnum(ConfigScopeType)
  fromScopeType!: ConfigScopeType;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fromScopeValue?: string;

  @IsEnum(ConfigScopeType)
  toScopeType!: ConfigScopeType;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  toScopeValue?: string;
}

/**
 * PATCH /hermes/v1/config/:configKey/status → activate the latest draft in scope.
 * config-service only honors `status=active` (drafts are created via PUT with status=draft).
 */
export class ConfigStatusDto extends HermesOperatorMutationDto {
  @IsEnum(ConfigurationStatus)
  status!: ConfigurationStatus;

  @IsOptional()
  @IsEnum(ConfigScopeType)
  scopeType?: ConfigScopeType;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  scopeValue?: string;
}
