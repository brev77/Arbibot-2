import { IsOptional, IsString, MinLength } from 'class-validator';

import { HermesOperatorMutationDto } from './operator-mutation.dto';

export class SafeModeMutationDto extends HermesOperatorMutationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  reason?: string;
}
