import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class ApplyFillDto {
  @IsOptional()
  @IsUUID('4')
  idempotencyKey?: string;

  /** Optimistic check: expected leg version before fill (optional). */
  @IsOptional()
  @IsInt()
  clientKnownVersion?: number;

  @IsOptional()
  @IsString()
  @IsIn(['full', 'partial'])
  @MaxLength(32)
  mode?: 'full' | 'partial';

  /**
   * Venue-reported cumulative filled for this leg (required when mode=partial).
   * Must strictly increase until it reaches targetQuantity (then leg becomes filled).
   */
  @ValidateIf((o: ApplyFillDto) => o.mode === 'partial')
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  cumulativeFilled?: number;
}
