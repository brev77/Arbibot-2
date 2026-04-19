import {
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreatePromotionCandidateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  instrumentKey!: string;

  @IsOptional()
  @IsUUID('4')
  opportunityId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  source?: string;

  @IsOptional()
  @IsNumber()
  score?: number;

  @IsOptional()
  @IsNumber()
  driftBps?: number;

  @IsOptional()
  @IsObject()
  evidence?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(512)
  enqueueIdempotencyKey?: string;
}
