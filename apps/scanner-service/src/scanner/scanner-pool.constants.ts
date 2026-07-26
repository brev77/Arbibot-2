/**
 * Scanner pool-reader constants (S1-5-POOL).
 *
 * Factory → { protocol, venueKey } mapping, sourced from
 * packages/contracts-eth/src/addresses/{arbitrum,bnb,base}.ts. Keyed by lowercase factory
 * address because the same numeric value can mean different venues across chains — but in
 * practice these factories are chain-specific, so the (chainId, factory) pair is the safe key.
 *
 * Venue keys match the convention in packages/contracts/src/events.ts:239 (buyVenue/sellVenue)
 * and DiscoveredPool.protocol (pool-discovery.service.ts:41): kebab-case lowercase
 * (uniswap-v2, uniswap-v3, sushiswap, pancakeswap-v2, pancakeswap-v3, biswap).
 */

/** DEX family — drives pool-reading strategy (V2 reserves vs V3 slot0). */
export type DexProtocolFamily = 'v2' | 'v3';

export interface FactoryMapping {
  venueKey: string;
  family: DexProtocolFamily;
  /** Pool fee in basis points (V2: 30 = 0.3%; V3 read on-chain per pool). */
  defaultFeeBps: number;
}

/**
 * Mapping keyed by `${chainId}:${lowercaseFactoryAddress}` → FactoryMapping.
 *
 * Sushi on Arbitrum/BNB = 0xc35DADB65012eC5796536bD9864eD8773aBc74C4 (deployed address from
 * contracts-eth; the scanner-service-plan.md "...EC41265..." variant is a plan typo — see
 * arbitrum.ts:42 / bnb.ts:62).
 */
export const FACTORY_MAPPING: ReadonlyMap<string, FactoryMapping> = new Map<
  string,
  FactoryMapping
>([
  // --- Arbitrum (42161) ---
  ['42161:0xf1d7cc64fb745938252f3b21e12e7c8398ce848e', { venueKey: 'uniswap-v2', family: 'v2', defaultFeeBps: 30 }],
  ['42161:0x1f98431c8ad98523631ae4a59f267346ea31f984', { venueKey: 'uniswap-v3', family: 'v3', defaultFeeBps: 0 }],
  ['42161:0xc35dadb65012ec5796536bd9864ed8773abc74c4', { venueKey: 'sushiswap', family: 'v2', defaultFeeBps: 30 }],

  // --- Ethereum mainnet (1) ---
  ['1:0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f', { venueKey: 'uniswap-v2', family: 'v2', defaultFeeBps: 30 }],
  ['1:0x1f98431c8ad98523631ae4a59f267346ea31f984', { venueKey: 'uniswap-v3', family: 'v3', defaultFeeBps: 0 }],
  ['1:0xc0aee478e3658e2610c5f7a4a2e1777ce9e4f2ac', { venueKey: 'sushiswap', family: 'v2', defaultFeeBps: 30 }],

  // --- Base (8453) ---
  ['8453:0x33128a8fc17869897dce68ed026d594dd274d2f3', { venueKey: 'uniswap-v3', family: 'v3', defaultFeeBps: 0 }],
  ['8453:0x7dae51ae332a0e1f979b1b1d01ed6d68468e41ec', { venueKey: 'sushiswap', family: 'v2', defaultFeeBps: 30 }],

  // --- BNB Chain (56) ---
  ['56:0xca143ce32fe78f1f7019d7d551a6402fc5350c73', { venueKey: 'pancakeswap-v2', family: 'v2', defaultFeeBps: 25 }],
  ['56:0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865', { venueKey: 'pancakeswap-v3', family: 'v3', defaultFeeBps: 0 }],
  ['56:0xdb1d10011ad0ff90774d0c6bb92e5c5c8b4461f7', { venueKey: 'uniswap-v3', family: 'v3', defaultFeeBps: 0 }],
  ['56:0xc35dadb65012ec5796536bd9864ed8773abc74c4', { venueKey: 'sushiswap', family: 'v2', defaultFeeBps: 30 }],
  ['56:0x858e3312ed3a876947ae49e6a8a2fa7a6b7819e8', { venueKey: 'biswap', family: 'v2', defaultFeeBps: 20 }],

  // --- Optimism (10) ---
  // Velodrome V2 (Solidly fork — volatile pools only; stable-pool pricing uses a flat curve).
  // defaultFeeBps is approximate (Solidly fees are dynamic, set per-pool).
  ['10:0xf1046053aa5682b4f9a81b5481394da16be5ff5a', { venueKey: 'velodrome', family: 'v2', defaultFeeBps: 30 }],
  // Uniswap V3 on Optimism (same factory address as Ethereum/Arb/Base).
  ['10:0x1f98431c8ad98523631ae4a59f267346ea31f984', { venueKey: 'uniswap-v3', family: 'v3', defaultFeeBps: 0 }],
]);

/** Resolve the factory mapping for a chain + factory address. Returns undefined if unknown. */
export function resolveFactory(
  chainId: number,
  factoryAddress: string,
): FactoryMapping | undefined {
  const key = `${chainId}:${factoryAddress.toLowerCase()}`;
  return FACTORY_MAPPING.get(key);
}

// --- Pool ABIs (human-readable; ethers v6 compiles these) ----------------------

/**
 * Uniswap V2-family pool ABI (UniV2/Sushi/PancakeV2/Biswap — all share the Pair interface).
 * Used by ScannerPoolService to read reserves + tokens + factory for protocol mapping.
 */
export const UNI_V2_POOL_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function factory() view returns (address)',
] as const;

/**
 * Uniswap V3-family pool ABI with volumeToken0()/volumeToken1() (corр. #1 раунда 4 in
 * scanner-service-plan.md). slot0 returns sqrtPriceX96 (the price) which the execution
 * pool-discovery service fails to read (gap at pool-discovery.service.ts:236). The volume
 * getters are mainnet-canonical; forks/testnets without them revert and the reader degrades
 * gracefully (corр. #1 раунда 2/4).
 */
export const UNI_V3_POOL_SCANNER_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() view returns (uint128)',
  'function factory() view returns (address)',
  // Scanner-specific: cumulative volume getters (mainnet-canonical UniV3 only).
  'function volumeToken0() view returns (uint256)',
  'function volumeToken1() view returns (uint256)',
] as const;

/** ERC20 decimals — needed to normalise V3 sqrtPriceX96 into a human price. */
export const ERC20_DECIMALS_ABI = [
  'function decimals() view returns (uint8)',
] as const;
