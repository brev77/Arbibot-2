/**
 * Stablecoin addresses (lowercased) used to price pool reserves in USD without an external
 * price oracle. When one leg of a pool is a stablecoin, its reserve is already denominated in
 * USD (≈ $1), so the pool's USD liquidity = the stablecoin reserve directly.
 *
 * Covers Arbitrum One, Base, and BNB Chain mainnets — the chains the scanner watches. Verified
 * on-chain (2026-08-10, BlockPi RPC): each address returns real bytecode (an ERC20 contract),
 * not the empty `0x` of a typo.
 *
 * Compared with the earlier PLAN13 `STABLE_QUOTE_ADDRESSES` set, this corrects two addresses
 * that were typos (0 bytes on-chain — the scanner silently treated USDC.e/USDT pools as
 * WETH-quoted, mispricing their liquidity by ~$1920x):
 *   - USDC.e Arbitrum: 0xff970a61a04b1ca14834a43f5de4533ebddb5cc8 (was ...a0441d484...)
 *   - USDT  Arbitrum: 0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9 (was ...7830bdb9...)
 *
 * Addresses are lowercased deliberately: token addresses from ethers `token0()`/`token1()`
 * are checksummed, and `.toLowerCase()` is the cheapest canonical comparison (avoids importing
 * ethers.getAddress for a set lookup).
 */
export const STABLE_QUOTE_ADDRESSES: ReadonlySet<string> = new Set<string>([
  // ── Arbitrum One ──────────────────────────────────────────────────────────────
  '0xaf88d065e77c8cc2239327c5edb3a432268e5831', // USDC (native, 6 decimals)
  '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8', // USDC.e (bridged, 6 decimals) — VERIFIED 2092 bytes
  '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', // USDT (6 decimals) — VERIFIED 2141 bytes
  '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', // DAI (18 decimals)
  // ── Base ──────────────────────────────────────────────────────────────────────
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC (native)
  '0x036cbd53842c5426634e7929541ec2318f3dcf7e', // USDC (bridged, Base L2)
  // ── BNB Chain ─────────────────────────────────────────────────────────────────
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC (BEP-20)
  '0x55d398326f99059ff775485246999027b3197955', // USDT (BEP-20)
]);

/**
 * Returns `1` if either token0 or token1 is a known stablecoin (so the pool's reserve is
 * already in USD), else `nativeUsd` (the WETH/WBNB USD price the caller resolved from env).
 *
 * Checks BOTH legs (token0 OR token1) because some pools sort the stablecoin as token0
 * (non-standard ordering, e.g. USDC/MAGIC rather than MAGIC/USDC). The earlier PLAN13 check
 * only looked at token1 and would miss those, mispricing them as native-quoted.
 */
export function resolveQuoteUsd(
  token0: string,
  token1: string,
  nativeUsd: number,
): number {
  if (STABLE_QUOTE_ADDRESSES.has(token0.toLowerCase()) || STABLE_QUOTE_ADDRESSES.has(token1.toLowerCase())) {
    return 1;
  }
  return nativeUsd;
}
