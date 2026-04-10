import { IsObject, IsOptional } from 'class-validator';

export class EnrichOpportunityDto {
  @IsOptional()
  @IsObject()
  payloadPatch?: Record<string, unknown>;
}
