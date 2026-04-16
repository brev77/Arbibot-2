import { IsIn, IsInt, IsOptional } from 'class-validator';

export class UpdateMismatchStatusDto {
  @IsIn(['open', 'investigating', 'resolved'])
  status!: 'open' | 'investigating' | 'resolved';

  @IsOptional()
  @IsInt()
  expectedEntityVersion?: number;
}
