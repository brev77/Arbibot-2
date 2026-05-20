import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Leg type discriminator matching execution_legs.leg_type column. */
type LegType = 'dex' | 'bridge';

/**
 * Descriptor for a single leg in a multi-leg cross-chain plan.
 *
 * - DEX legs: specify `chainId`, optional `venueKey`, optional `targetQuantity`
 * - Bridge legs: specify `chainId`, `bridgeKey`, `destinationChainId`, `token`,
 *   `destinationToken`, `amount`, optional `recipientAddress`
 */
export class LegDescriptorDto {
  /** Leg type: 'dex' for on-chain swap, 'bridge' for cross-chain transfer. */
  @IsEnum(['dex', 'bridge'])
  legType!: LegType;

  /** Chain ID where this leg executes. */
  @IsInt()
  @Min(1)
  @Type(() => Number)
  chainId!: number;

  /** Target quantity for this leg (default: 1). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  targetQuantity?: number;

  // ── DEX-specific ──────────────────────────────────────────────────────

  /** Venue key for DEX legs (e.g. 'uniswap-v2', 'uniswap-v3', 'sushiswap'). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  venueKey?: string;

  // ── Bridge-specific ───────────────────────────────────────────────────

  /** Bridge adapter key (e.g. 'across', 'stargate', 'native'). Required for bridge legs. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  bridgeKey?: string;

  /** Destination chain ID for bridge legs. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  destinationChainId?: number;

  /** Token address on the source chain. Required for bridge legs. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(66)
  token?: string;

  /** Token address on the destination chain (may differ for wrapped tokens). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(66)
  destinationToken?: string;

  /** Amount in smallest token units (string to avoid precision loss). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  amount?: string;

  /** Recipient wallet address on the destination chain. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(66)
  recipientAddress?: string;
}

/**
 * DTO for creating a multi-leg cross-chain execution plan.
 *
 * Example (Arbitrum → Base):
 * ```json
 * {
 *   "legs": [
 *     { "legType": "dex", "chainId": 42161, "venueKey": "uniswap-v3", "targetQuantity": 100 },
 *     { "legType": "bridge", "chainId": 42161, "bridgeKey": "across",
 *       "destinationChainId": 8453, "token": "0x...", "destinationToken": "0x...",
 *       "amount": "1000000000000000000" },
 *     { "legType": "dex", "chainId": 8453, "venueKey": "uniswap-v3", "targetQuantity": 100 }
 *   ]
 * }
 * ```
 */
export class CreateMultiLegPlanDto {
  @IsOptional()
  @IsUUID('4')
  correlationId?: string;

  @IsOptional()
  @IsUUID('4')
  riskDecisionId?: string;

  /** Optional canonical route/instrument key for portfolio aggregation. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  routeKey?: string;

  /** Ordered list of leg descriptors (minimum 2 for cross-chain). */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LegDescriptorDto)
  legs!: LegDescriptorDto[];
}