import { Address } from '../types/address';
import { ChainId } from '../types/chain-id';

/**
 * DEX addresses on Base
 */
export interface BaseAddresses {
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
 * Base Mainnet addresses
 *
 * Sources:
 * - Uniswap V3: https://docs.uniswap.org/contracts/v3/reference/deployments/base
 * - SushiSwap: https://www.sushi.com/chain-ids
 */
export const BaseMainnetAddresses: BaseAddresses = {
  // Uniswap V2 (not deployed on Base)
  uniswapV2Router: '0x0000000000000000000000000000000000000000',
  uniswapV2Factory: '0x0000000000000000000000000000000000000000',
  // Uniswap V3 (SwapRouter02)
  uniswapV3Router: '0x2626664c2603336E57B55794666850a4e5c3A2F6',
  uniswapV3Factory: '0x33128a8fC17869897dcE68Ed026d594dd274D2f3',
  // SushiSwap V2
  sushiSwapRouter: '0x6BDED42c6DA8FBf0d2bA55B2fa120Ec19711BCee',
  sushiSwapFactory: '0x7DAe51AE332a0e1F979B1b1d01eD6d68468e41eC',
  // WETH (Wrapped Ether on Base)
  weth: '0x4200000000000000000000000000000000000006',
  // USDC (native USDC on Base)
  usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  // USDT
  usdt: '0xfdeBeC2fcC5819D3B0a2499F5CC2b2b2AA1a806e',
};

/**
 * Base Sepolia Testnet addresses
 */
export const BaseSepoliaAddresses: BaseAddresses = {
  // Uniswap V2 (not deployed on Base Sepolia)
  uniswapV2Router: '0x0000000000000000000000000000000000000000',
  uniswapV2Factory: '0x0000000000000000000000000000000000000000',
  // Uniswap V3 (SwapRouter02)
  uniswapV3Router: '0x94cC0AaC5338A89d4C4A095063cEA4D13e00Cf42',
  uniswapV3Factory: '0x1233427D9291214787Ee4c65a2a3a649a0A849E4',
  // SushiSwap
  sushiSwapRouter: '0x0000000000000000000000000000000000000000',
  sushiSwapFactory: '0x0000000000000000000000000000000000000000',
  // WETH
  weth: '0x39B068B95720a4d9D492A6A41CF37E75D67DcE1D',
  // USDC
  usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  // USDT
  usdt: '0x0000000000000000000000000000000000000000',
};

/**
 * Get addresses by Base chain ID
 */
export function getBaseAddresses(chainId: ChainId): BaseAddresses {
  switch (chainId) {
    case ChainId.BASE_MAINNET:
      return BaseMainnetAddresses;
    case ChainId.BASE_SEPOLIA:
      return BaseSepoliaAddresses;
    default:
      throw new Error(`Unsupported Base chain ID: ${chainId}`);
  }
}
