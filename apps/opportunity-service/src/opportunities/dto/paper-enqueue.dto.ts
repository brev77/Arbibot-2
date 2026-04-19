import { IsNumber, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class PaperEnqueueDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  instrumentKey?: string;

  @IsOptional()
  @IsNumber()
  score?: number;

  @IsOptional()
  @IsNumber()
  driftBps?: number;

  @IsOptional()
  @IsObject()
  evidence?: Record<string, unknown>;
}
