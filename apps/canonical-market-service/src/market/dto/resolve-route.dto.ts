import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class ResolveRouteDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  routeKey?: string;

  @IsOptional()
  @IsUUID('4')
  sourceInstrumentId?: string;

  @IsOptional()
  @IsUUID('4')
  targetInstrumentId?: string;
}
