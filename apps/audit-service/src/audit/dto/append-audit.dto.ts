import { IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AppendAuditDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsString()
  @MinLength(1)
  actor!: string;

  @IsString()
  @MinLength(1)
  action!: string;

  @IsOptional()
  @IsString()
  resourceType?: string;

  @IsOptional()
  @IsString()
  resourceId?: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
