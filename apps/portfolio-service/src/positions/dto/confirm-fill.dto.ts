import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** Confirmed fill from execution path; portfolio is single-writer for positions. */
export class ConfirmFillDto {
  @IsUUID('4')
  planId!: string;

  @IsUUID('4')
  legId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(512)
  instrumentKey!: string;

  /** Positive quantity increment as decimal string. */
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  quantity!: string;

  @IsUUID('4')
  idempotencyKey!: string;
}
