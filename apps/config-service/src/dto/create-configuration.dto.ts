import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export enum ConfigScopeType {
  GLOBAL = 'global',
  ENVIRONMENT = 'environment',
  TENANT = 'tenant',
}

export class CreateConfigurationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  configKey!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  configValue!: string;

  @IsBoolean()
  @IsOptional()
  isSensitive?: boolean;

  @IsEnum(ConfigScopeType)
  @IsOptional()
  scopeType?: ConfigScopeType;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  scopeValue?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  approveReason?: string;
}

// DTOs for scoped queries
export class QueryConfigurationsDto {
  @IsEnum(ConfigScopeType)
  @IsOptional()
  scopeType?: ConfigScopeType;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  scopeValue?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  environment?: string; // Convenience param for scopeValue when scopeType=environment

  @IsString()
  @IsOptional()
  @MaxLength(255)
  tenantId?: string; // Convenience param for scopeValue when scopeType=tenant
}
