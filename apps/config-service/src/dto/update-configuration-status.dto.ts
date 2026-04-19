import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { ConfigScopeType, ConfigurationStatus } from './create-configuration.dto';

export class UpdateConfigurationStatusDto {
  @IsEnum(ConfigurationStatus)
  status!: ConfigurationStatus;

  @IsEnum(ConfigScopeType)
  @IsOptional()
  scopeType?: ConfigScopeType;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  scopeValue?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  approveReason?: string;
}
