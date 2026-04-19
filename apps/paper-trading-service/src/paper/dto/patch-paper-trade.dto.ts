import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

import { PAPER_TRADE_STATES, type PaperTradeState } from '@arbibot/persistence';

export class PatchPaperTradeDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  notional?: string;

  @IsOptional()
  @IsIn([...PAPER_TRADE_STATES])
  state?: PaperTradeState;
}
