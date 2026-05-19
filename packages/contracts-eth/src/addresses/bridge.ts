import { Address } from '../types/address';
import { ChainId } from '../types/chain-id';

/**
 * Bridge contract addresses.
 *
 * Step: DEX-2-1-BRIDGE-ACROSS
 *
 * Across Protocol SpokePool addresses per chain.
 * Reference: https://docs.across.to/developers/contract-addresses
 */

export interface AcrossAddresses {
  /** SpokePool contract address on this chain. */
  spokePool: Address;
}

/**
 * Across mainnet addresses.
 */
export const ACROSS_MAINNET: Record<number, AcrossAddresses> = {
  [ChainId.ETHEREUM_MAINNET]: {
    spokePool: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5' as Address,
  },
  [ChainId.ARBITRUM_ONE_MAINNET]: {
    spokePool: '0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A' as Address,
  },
  [ChainId.BASE_MAINNET]: {
    spokePool: '0x09aea4b2242abC8bb4BB78D537A67a245a7bEC64' as Address,
  },
};

/**
 * Across testnet (Sepolia) addresses.
 */
export const ACROSS_TESTNET: Record<number, AcrossAddresses> = {
  [ChainId.ETHEREUM_TESTNET_SEPOLIA]: {
    spokePool: '0x5ef6C01E11839d1B5F5146a3cF26a90e2b5B3C81' as Address,
  },
  [ChainId.ARBITRUM_ONE_SEPOLIA]: {
    spokePool: '0x60AbD308cCEE43443b12B02De943B3E3abD3DB21' as Address,
  },
  [ChainId.BASE_SEPOLIA]: {
    spokePool: '0x03f78791E7a2f21ca2a792cb12C24Fba6E07EfbC' as Address,
  },
};

/**
 * Get Across SpokePool address for a given chain ID.
 */
export function getAcrossAddresses(chainId: number): AcrossAddresses {
  const mainnet = ACROSS_MAINNET[chainId];
  if (mainnet) {
    return mainnet;
  }

  const testnet = ACROSS_TESTNET[chainId];
  if (testnet) {
    return testnet;
  }

  throw new Error(`Across: no SpokePool address for chainId ${chainId}`);
}

/**
 * Check if Across supports a given chain pair.
 */
export function isAcrossSupportedChainPair(
  sourceChainId: number,
  destinationChainId: number,
): boolean {
  const allAddresses = { ...ACROSS_MAINNET, ...ACROSS_TESTNET };
  return sourceChainId in allAddresses && destinationChainId in allAddresses;
}