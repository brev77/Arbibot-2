import { IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

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

  /**
   * USD notional of this fill increment (D4-B-3-CEILING), as a non-negative
   * decimal string. Accumulated into `portfolio_positions.notional_usd`, which
   * capital-service SUMs into the aggregate capital ceiling when the position
   * is open (quantity <> 0). Optional + defaults to '0' for backward-compat
   * with callers that do not yet price the fill; the position row is still
   * created in that case (notional simply stays 0).
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d+)?$/, { message: 'notionalUsd must be a non-negative decimal string' })
  @MaxLength(64)
  notionalUsd?: string;

  @IsUUID('4')
  idempotencyKey!: string;
}
