import { IsObject, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class AppendAuditDto {
  @IsOptional()
  @IsUUID('4')
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
