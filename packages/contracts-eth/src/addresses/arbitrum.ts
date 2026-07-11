import { Address } from '../types/address';
import { ChainId } from '../types/chain-id';

/**
 * DEX addresses on Arbitrum
 */
export interface ArbitrumAddresses {
  // Uniswap V2
  uniswapV2Router: Address;
  uniswapV2Factory: Address;
  // Uniswap V3
  uniswapV3Router: Address;
  uniswapV3Factory: Address;
  // SushiSwap
  sushiSwapRouter: Address;
  sushiSwapFactory: Address;
  // WETH
  weth: Address;
  // USDC
  usdc: Address;
  // USDT
  usdt: Address;
}

/**
 * Arbitrum Mainnet addresses
 */
export const ArbitrumMainnetAddresses: ArbitrumAddresses = {
  // Uniswap V2
  uniswapV2Router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
  uniswapV2Factory: '0xf1D7CC64Fb745938252F3B21e12e7C8398cE848e',
  // Uniswap V3
  uniswapV3Router: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  uniswapV3Factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  // SushiSwap
  sushiSwapRouter: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
  sushiSwapFactory: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4',
  // WETH
  weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  // USDC
  usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  // USDT
  usdt: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
};

/**
 * Arbitrum Sepolia Testnet addresses
 */
export const ArbitrumSepoliaAddresses: ArbitrumAddresses = {
  // Uniswap V2
  uniswapV2Router: '0x4752ba5dbc23f44d87826276bf6fd6b6c874abfc',
  uniswapV2Factory: '0xd1F20C1c6864211b0Ce7b6AdF4d82E5B85cAb2c0',
  // Uniswap V3
  uniswapV3Router: '0x3bFA4769FB09eefC5a80d58Ea2719aF8D5Be33b0',
  uniswapV3Factory: '0x31e2a1d903E458bB0F7770965e6d8211f2348919',
  // SushiSwap
  sushiSwapRouter: '0x4752ba5dbc23f44d87826276bf6fd6b6c874abfc',
  sushiSwapFactory: '0xd1F20C1c6864211b0Ce7b6AdF4d82E5B85cAb2c0',
  // WETH
  weth: '0x4200000000000000000000000000000000000006',
  // USDC
  usdc: '0x75faf114eafb1acbe2a3976482854f7f230fa178',
  // USDT
  usdt: '0x319c9e4a6554Ae6e5D75979e9d009D84B6Fb53f6',
};

/**
 * Get addresses by Arbitrum chain ID
 */
export function getArbitrumAddresses(chainId: ChainId): ArbitrumAddresses {
  switch (chainId) {
    case ChainId.ARBITRUM_ONE_MAINNET:
      return ArbitrumMainnetAddresses;
    case ChainId.ARBITRUM_ONE_SEPOLIA:
      return ArbitrumSepoliaAddresses;
    default:
      throw new Error(`Unsupported Arbitrum chain ID: ${chainId}`);
  }
}