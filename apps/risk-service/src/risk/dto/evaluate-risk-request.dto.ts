import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class EvaluateRiskRequestDto {
  @IsOptional()
  @IsUUID('4')
  idempotencyKey?: string;

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

  @Type(() => Number)
  @IsInt()
  @Min(1)
  snapshotVersion!: number;

  @IsOptional()
  @IsIn(['fast', 'standard', 'conservative'])
  riskMode?: 'fast' | 'standard' | 'conservative';

  @IsOptional()
  @IsUUID('4')
  riskWindowReservationId?: string;
}
