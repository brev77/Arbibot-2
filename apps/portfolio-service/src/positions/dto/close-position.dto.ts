import { IsInt, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** Operator close — sets position quantity to zero (single-writer portfolio). */
export class ClosePositionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  operatorId!: string;

  @IsOptional()
  @IsUUID('4')
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  approveReason?: string;

  /** Optimistic concurrency: must match current entity_version when provided. */
  @IsOptional()
  @IsInt()
  expectedEntityVersion?: number;
}
