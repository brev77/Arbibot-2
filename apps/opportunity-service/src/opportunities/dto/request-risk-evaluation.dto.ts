import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

export class RequestRiskEvaluationDto {
  @IsOptional()
  @IsUUID('4')
  correlationId?: string;

  @IsOptional()
  @IsUUID('4')
  idempotencyKey?: string;

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
