import { IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreatePaperTradeDto {
  @IsOptional()
  @IsUUID('4')
  opportunityId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(512)
  instrumentKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  routeKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  notional?: string;

  @IsOptional()
  @IsObject()
  summary?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  idempotencyKey?: string;
}
