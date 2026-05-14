import { Address } from '../types/address';
import { ChainId } from '../types/chain-id';

/**
 * DEX addresses on BNB Chain
 *
 * Note: BNB Chain uses PancakeSwap as the primary DEX (V2 and V3),
 * plus Biswap. SushiSwap is also deployed but with lower liquidity.
 */
export interface BnbAddresses {
  // PancakeSwap V2
  pancakeV2Router: Address;
  pancakeV2Factory: Address;
  // PancakeSwap V3
  pancakeV3Router: Address;
  pancakeV3Factory: Address;
  // Uniswap V3 (deployed on BNB)
  uniswapV3Router: Address;
  uniswapV3Factory: Address;
  // SushiSwap
  sushiSwapRouter: Address;
  sushiSwapFactory: Address;
  // Biswap V2
  biswapV2Router: Address;
  biswapV2Factory: Address;
  // WBNB
  wbnb: Address;
  // USDT (BEP-20)
  usdt: Address;
  // USDC (BEP-20, bridged)
  usdc: Address;
  // BUSD (deprecated but still present)
  busd: Address;
}

/**
 * BNB Chain Mainnet addresses
 *
 * Sources:
 * - PancakeSwap: https://docs.pancakeswap.finance/
 * - Uniswap V3 on BNB: https://docs.uniswap.org/contracts/v3/reference/deployments
 * - SushiSwap: https://www.sushi.com/chain-ids
 */
export const BnbMainnetAddresses: BnbAddresses = {
  // PancakeSwap V2
  pancakeV2Router: '0x10ED43C718714eb63d5aA57B78B54704E256024E' as Address,
  pancakeV2Factory: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73' as Address,
  // PancakeSwap V3 (SmartRouter)
  pancakeV3Router: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4' as Address,
  pancakeV3Factory: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865' as Address,
  // Uniswap V3
  uniswapV3Router: '0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2' as Address,
  uniswapV3Factory: '0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7' as Address,
  // SushiSwap
  sushiSwapRouter: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506' as Address,
  sushiSwapFactory: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4' as Address,
  // Biswap V2
  biswapV2Router: '0x3a6d8cA8D9C0a3E4585c2a2c84D7A36e0301A4E' as Address,
  biswapV2Factory: '0x858E3312ed3A876947AE49e6A8A2fA7A6b7819E8' as Address,
  // WBNB
  wbnb: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' as Address,
  // USDT (BEP-20)
  usdt: '0x55d398326f99059fF775485246999027B3197955' as Address,
  // USDC (BEP-20 bridged)
  usdc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' as Address,
  // BUSD (deprecated)
  busd: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56' as Address,
};

/**
 * BNB Chain Testnet addresses
 */
export const BnbTestnetAddresses: BnbAddresses = {
  // PancakeSwap V2
  pancakeV2Router: '0xD99D1c33F9fC3444f8101754aBC46c52416550D1' as Address,
  pancakeV2Factory: '0x6725F303b657a9451d8BA641348b6761A6CC7a17' as Address,
  // PancakeSwap V3
  pancakeV3Router: '0x1b81D678ffb9C0263b24A97847620C99d213eB14' as Address,
  pancakeV3Factory: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865' as Address,
  // Uniswap V3 (not deployed on BNB testnet)
  uniswapV3Router: '0x0000000000000000000000000000000000000000' as Address,
  uniswapV3Factory: '0x0000000000000000000000000000000000000000' as Address,
  // SushiSwap
  sushiSwapRouter: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506' as Address,
  sushiSwapFactory: '0x0000000000000000000000000000000000000000' as Address,
  // Biswap V2 (not deployed on BNB testnet)
  biswapV2Router: '0x0000000000000000000000000000000000000000' as Address,
  biswapV2Factory: '0x0000000000000000000000000000000000000000' as Address,
  // WBNB
  wbnb: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd' as Address,
  // USDT (testnet)
  usdt: '0x337610d27c682F34CbC18Be42BA2e79e04c15e35' as Address,
  // USDC (testnet)
  usdc: '0x64544969ed7EBf5f083679233325356EbE738930' as Address,
  // BUSD (testnet)
  busd: '0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee' as Address,
};

/**
 * Get addresses by BNB chain ID
 */
export function getBnbAddresses(chainId: ChainId): BnbAddresses {
  switch (chainId) {
    case ChainId.BNB_CHAIN_MAINNET:
      return BnbMainnetAddresses;
    case ChainId.BNB_CHAIN_TESTNET:
      return BnbTestnetAddresses;
    default:
      throw new Error(`Unsupported BNB chain ID: ${chainId}`);
  }
}
