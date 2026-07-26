import { Address } from '../types/address';
import { ChainId } from '../types/chain-id';

/**
 * DEX addresses on Optimism
 *
 * Velodrome is the dominant Solidly-fork AMM on OP Mainnet (volatile + stable pools, standard
 * V2 getReserves ABI). Uniswap V3 is also deployed here; addresses below cover the scanner's
 * factory-mapping needs. Scanner-only scope — execution-orchestrator does not trade on
 * Optimism yet (no router adapters); this file exists so @arbibot/contracts-eth can resolve
 * tokens/factories for the cross-DEX scanner (Phase 2 of scanner expansion).
 */
export interface OptimismAddresses {
  // Velodrome (Solidly V2 fork — volatile pools)
  velodromeRouter: Address;
  velodromeFactory: Address;
  // Uniswap V3
  uniswapV3Router: Address;
  uniswapV3Factory: Address;
  // WETH (canonical Optimism WETH — same address as Base, 0x4200...0006)
  weth: Address;
  // USDC (native USDC on Optimism, 6 decimals)
  usdc: Address;
  // USDT
  usdt: Address;
  // OP token (native governance token, 18 decimals)
  op: Address;
  // VELO token (18 decimals)
  velo: Address;
  // Chainlink price feed proxies (AggregatorV3Interface)
  chainlinkEthUsd: Address;
  chainlinkUsdcUsd: Address;
}

/**
 * Optimism Mainnet addresses
 *
 * Sources: Velodrome docs / Optimistic Etherscan / Chainlink docs.
 * - Velodrome Pool Factory V2: 0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a
 * - Uniswap V3 factory on Optimism: 0x1F98431c8aD98523631AE4a59f267346ea31F984
 *   (same address as Ethereum/Arbitrum/Base — Uniswap deploys deterministically)
 * - WETH: 0x4200000000000000000000000000000000000006 (Optimism canonical)
 * - USDC (native): 0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85
 */
export const OptimismMainnetAddresses: OptimismAddresses = {
  // Velodrome (Solidly V2 fork — volatile pools only for accurate v2Price)
  velodromeRouter: '0xa062aE8ADF9c7717BA7a2364a8F8a25202F1fCB1',
  velodromeFactory: '0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a',
  // Uniswap V3
  uniswapV3Router: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  uniswapV3Factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  // WETH (Optimism canonical — shared with Base)
  weth: '0x4200000000000000000000000000000000000006',
  // USDC (native USDC on Optimism, 6 decimals)
  usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  // USDT
  usdt: '0x94b008aA00579c1307B0EF2c499aD98a8ceB58nE',
  // OP token (native governance token, 18 decimals)
  op: '0x4200000000000000000000000000000000000042',
  // VELO token (18 decimals)
  velo: '0x3c8B650257cFb5f272f799F5e62b4134f0225b14',
  // Chainlink price feed proxies (AggregatorV3Interface)
  // Source: https://docs.chain.link/data-feeds/price-feeds/addresses
  chainlinkEthUsd: '0x13e3Ee699D1909E989722E753853AE31b37A0592',
  chainlinkUsdcUsd: '0x16a9FA2DAc0a2785583D7eAA421b852666a58a8F',
};

/**
 * Get addresses by Optimism chain ID
 */
export function getOptimismAddresses(chainId: ChainId): OptimismAddresses {
  switch (chainId) {
    case ChainId.OPTIMISM_MAINNET:
      return OptimismMainnetAddresses;
    default:
      throw new Error(`Unsupported Optimism chain ID: ${chainId}`);
  }
}
