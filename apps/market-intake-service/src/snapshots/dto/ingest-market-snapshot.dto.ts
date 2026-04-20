import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';

export class IngestMarketSnapshotDto {
  @IsOptional()
  @IsUUID('4')
  idempotencyKey?: string;

  @IsOptional()
  @IsUUID('4')
  correlationId?: string;

  @IsString()
  @MinLength(1)
  venueCode!: string;

  @IsString()
  @MinLength(1)
  venueSymbol!: string;

  @IsOptional()
  @IsUUID('4')
  canonicalInstrumentId?: string;

  /** Optional token/instrument key for watchlist tier + throttling (Phase 4). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  instrumentKey?: string;

  /** Optional route key for route-scoring gate (Phase 4). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  routeKey?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  bid?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  ask?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  last?: number;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @IsString()
  @MinLength(1)
  observedAt!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  staleAfterSeconds?: number;
}
