import { IsOptional, IsString, MinLength } from 'class-validator';

import { OpenclawOperatorMutationDto } from './operator-mutation.dto';

export class SafeModeMutationDto extends OpenclawOperatorMutationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  reason?: string;
}
