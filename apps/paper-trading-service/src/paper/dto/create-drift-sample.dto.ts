import { IsNumber, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateDriftSampleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  instrumentKey!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  paperMid!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  referenceMid!: string;

  @IsNumber()
  driftBps!: number;
}
