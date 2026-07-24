import { ChainId } from '@arbibot/contracts-eth';
import { id } from 'ethers';

/**
 * Scanner volume-reader constants (S1-6-VOLUME).
 *
 * Two volume strategies:
 *   - V3 cumulative (volumeToken0/volumeToken1) — single view call, diffed against a baseline.
 *     Mainnet-canonical UniV3 only; forks/testnets revert and the reader degrades gracefully.
 *   - V2 short-window Swap logs — eth_getLogs over a bounded block range, summing amounts.
 *     V2 has no cumulative-volume getter; 24h V2 via full-range getLogs is a non-goal.
 *
 * Default OFF (filters.volumeRange.enabled=false); the filter engine opts in per-instance.
 * See docs/scanner-service-plan.md §3 (Phase 1 Volume Reader).
 */

/**
 * Swap event topic0, computed via ethers.id() from the canonical signatures (NOT hardcoded hex —
 * 64-hex strings trip secret-scanning as ethereum-private-key; signature → id() is the single
 * source of truth — корр. #2 раунда 5).
 *
 * V2-family (UniV2/Sushi/PancakeV2/Biswap): Swap(address indexed sender, uint amount0In,
 *   uint amount1In, uint amount0Out, uint amount1Out, address indexed to)
 * V3-family: Swap(address indexed sender, address indexed recipient, int256 amount0,
 *   int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)
 *
 * ⚠️ Pancake V3 / Biswap V3 forks may carry a modified Swap event (extra fields) → different
 * signature → different topic; MVP scope = canonical UniV2 + UniV3.
 */
export const V2_SWAP_EVENT_SIGNATURE =
  'Swap(address,uint256,uint256,uint256,uint256,address)';
export const V3_SWAP_EVENT_SIGNATURE =
  'Swap(address,address,int256,int256,uint160,uint128,int24)';
export const V2_SWAP_TOPIC0 = id(V2_SWAP_EVENT_SIGNATURE);
export const V3_SWAP_TOPIC0 = id(V3_SWAP_EVENT_SIGNATURE);

/** V2 Swap human-readable ABI for ethers v6 Contract event decoding. */
export const V2_SWAP_EVENT_ABI = [
  'event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)',
] as const;

/** V3 Swap human-readable ABI (for decoded amount0/amount1 signed deltas). */
export const V3_SWAP_EVENT_ABI = [
  'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
] as const;

/**
 * Approximate block time (seconds) per chain — used to convert a time window (e.g. 1h) into a
 * bounded block count for eth_getLogs. Coarse; the reader clamps to a hard cap to stay within
 * public-RPC log limits (corр. #1+#3 раунда 2/4).
 */
export const CHAIN_BLOCK_TIME_SECONDS: ReadonlyMap<number, number> = new Map([
  [ChainId.ARBITRUM_ONE_MAINNET, 0.27], // Arbitrum ~0.27s/block (~13_300/h)
  [ChainId.BASE_MAINNET, 2], // Base ~2s/block (~1_800/h)
  [ChainId.BNB_CHAIN_MAINNET, 3], // BNB ~3s/block (~1_200/h)
]);

/** Hard cap on the block window to bound eth_getLogs cost on fast chains (Arbitrum). */
export const MAX_V2_LOG_BLOCK_WINDOW = 14_400; // ~1h on Arbitrum

/** Default 1h window (seconds) for V2 Swap-log volume. */
export const DEFAULT_V2_WINDOW_SECONDS = 3_600;

/** Resolve a bounded block window for a chain + time window (seconds), clamped to the cap. */
export function blockWindowFor(
  chainId: number,
  windowSeconds: number,
): number {
  const blockTime = CHAIN_BLOCK_TIME_SECONDS.get(chainId) ?? 2;
  const blocks = Math.ceil(windowSeconds / blockTime);
  return Math.min(MAX_V2_LOG_BLOCK_WINDOW, Math.max(1, blocks));
}
