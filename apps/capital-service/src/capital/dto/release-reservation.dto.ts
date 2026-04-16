import { IsOptional, IsUUID } from 'class-validator';

/** Optional body for release; reservation id is in the URL. */
export class ReleaseReservationDto {
  @IsOptional()
  @IsUUID('4')
  idempotencyKey?: string;
}
