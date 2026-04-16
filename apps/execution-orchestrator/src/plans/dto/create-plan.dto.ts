import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreatePlanDto {
  @IsOptional()
  @IsUUID('4')
  correlationId?: string;

  @IsOptional()
  @IsUUID('4')
  riskDecisionId?: string;

  /** Optional canonical route/instrument key for portfolio aggregation (e.g. `arb:canonical:route:…`). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  routeKey?: string;
}
