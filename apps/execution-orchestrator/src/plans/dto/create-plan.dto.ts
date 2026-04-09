import { IsOptional, IsUUID } from 'class-validator';

export class CreatePlanDto {
  @IsOptional()
  @IsUUID('4')
  correlationId?: string;

  @IsOptional()
  @IsUUID('4')
  riskDecisionId?: string;
}
