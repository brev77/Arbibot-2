import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ReserveCapitalDto {
  @IsUUID('4')
  correlationId!: string;

  @IsOptional()
  @IsUUID('4')
  planId?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(0)
  amountUsd!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(86_400)
  ttlSeconds?: number;
}
