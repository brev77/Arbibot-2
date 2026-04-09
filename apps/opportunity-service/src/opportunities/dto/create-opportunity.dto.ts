import { IsObject, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateOpportunityDto {
  @IsOptional()
  @IsUUID('4')
  correlationId?: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
