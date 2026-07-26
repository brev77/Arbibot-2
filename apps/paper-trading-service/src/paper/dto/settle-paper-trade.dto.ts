import { IsInt, IsNumber, IsOptional, Min } from 'class-validator';

/**
 * Settlement payload for `POST /paper/trades/:id/settle` (PAD-2).
 *
 * `entryPrice` / `exitPrice` / `profitUsd` are caller-supplied: the AutoDriveWorker
 * sources them from the promotion candidate's persisted opportunity-P/L (v1.1 contract
 * fields), an operator may supply manual values. The settle path records them verbatim
 * onto `paper_trades.{entry_price, exit_price, profit_usd, settled_at}`.
 */
export class SettlePaperTradeDto {
  @IsNumber()
  entryPrice!: number;

  @IsNumber()
  exitPrice!: number;

  @IsNumber()
  profitUsd!: number;

  /** Optional override for `spread_bps` recorded into `summary` for /stats aggregation. */
  @IsOptional()
  @IsNumber()
  spreadBps?: number;

  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
