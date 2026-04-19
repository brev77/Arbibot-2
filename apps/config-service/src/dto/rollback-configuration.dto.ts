import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { ConfigScopeType } from './create-configuration.dto';

export class RollbackConfigurationDto {
  @IsInt()
  @IsNotEmpty()
  toVersion!: number;

  @IsEnum(ConfigScopeType)
  @IsOptional()
  scopeType?: ConfigScopeType;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  scopeValue?: string;

  @IsBoolean()
  @IsOptional()
  isSensitive?: boolean; // Override from rollback target

  @IsString()
  @IsOptional()
  @MaxLength(255)
  approveReason?: string; // Required if isSensitive=true
}
