import { IsInt, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

/** Required context for approve-gated Hermes mutations (audit + idempotency). */
export class HermesOperatorMutationDto {
  /** Operator identity (matches BFF `x-operator-id` / audit actor; not necessarily a UUID). */
  @IsString()
  @MinLength(1)
  operatorId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  approveReason?: string;

  @IsOptional()
  @IsUUID('4')
  idempotencyKey?: string;

  /** Portfolio close / reconciliation PATCH — optional optimistic concurrency. */
  @IsOptional()
  @IsInt()
  expectedEntityVersion?: number;
}

/** Resolve reconciliation mismatch to a terminal status (typically resolved). */
export class ResolveIncidentMutationDto extends HermesOperatorMutationDto {}
