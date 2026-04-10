import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ReserveRiskWindowRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  windowKey!: string;

  @IsUUID('4')
  correlationId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  planReference!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  notionalUsd!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(86_400)
  ttlSeconds?: number;
}
