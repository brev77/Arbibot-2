import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class EvaluateRiskRequestDto {
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
}
