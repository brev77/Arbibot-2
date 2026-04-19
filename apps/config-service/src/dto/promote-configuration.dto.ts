import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { ConfigScopeType } from './create-configuration.dto';

export class PromoteConfigurationDto {
  @IsEnum(ConfigScopeType)
  fromScopeType!: ConfigScopeType;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  fromScopeValue?: string | null;

  @IsEnum(ConfigScopeType)
  toScopeType!: ConfigScopeType;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  toScopeValue?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  approveReason?: string;

  @IsString()
  @IsOptional()
  @MaxLength(128)
  idempotencyKey?: string;
}
