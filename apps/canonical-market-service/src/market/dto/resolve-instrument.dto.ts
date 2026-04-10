import { IsOptional, IsString, MinLength } from 'class-validator';

export class ResolveInstrumentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  venueCode?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  venueSymbol?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  canonicalKey?: string;
}
