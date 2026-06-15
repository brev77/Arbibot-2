/**
 * Body for `PATCH /alerts/incidents/:id` (Drill #1 gap #5).
 *
 * Optimistic concurrency is mandatory: callers MUST pass the `entityVersion`
 * they observed in the GET response. A stale value results in HTTP 409.
 *
 * - `status: 'investigating'` — operator acknowledgement
 * - `status: 'resolved'`      — manual close (sets resolvedAt/resolvedBy)
 */
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdateAlertIncidentStatusDto {
  @IsIn(['investigating', 'resolved'])
  status!: 'investigating' | 'resolved';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedEntityVersion!: number;

  @IsOptional()
  @IsString()
  resolvedBy?: string | null;
}
