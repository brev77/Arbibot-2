import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Operator identity for panic actions (matches BFF `x-operator-id` / audit actor). */
export class PanicActionDto {
  /** Operator identity (not necessarily a UUID). */
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  operatorId!: string;

  /** Optional reason captured in the audit trail. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

/** Recovery requires the explicit typed confirmation (D4-C-3-PANIC). */
export class PanicRecoverDto extends PanicActionDto {
  /** Must equal `I UNDERSTAND THIS RESUMES TRADING`. */
  @IsString()
  @MinLength(1)
  confirm!: string;
}

export const PANIC_RECOVER_CONFIRM_PHRASE =
  'I UNDERSTAND THIS RESUMES TRADING';
