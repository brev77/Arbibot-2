import { IsIn, IsInt, Min } from 'class-validator';

import {
  PAPER_PROMOTION_STATUSES,
  type PaperPromotionStatus,
} from '@arbibot/persistence';

export class PatchPromotionCandidateDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsIn([...PAPER_PROMOTION_STATUSES])
  status!: PaperPromotionStatus;
}
