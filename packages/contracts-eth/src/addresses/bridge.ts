import { Address } from '../types/address';
import { ChainId } from '../types/chain-id';

/**
 * Bridge contract addresses.
 *
 * Steps: DEX-2-1-BRIDGE-ACROSS, DEX-2-1-BRIDGE-STG
 *
 * Across Protocol SpokePool addresses per chain.
 * Reference: https://docs.across.to/developers/contract-addresses
 *
 * Stargate V2 Router addresses per chain.
 * Reference: https://stargateprotocol.gitbook.io/stargate/v2
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

// ───────────────────────────────────────────────────────────────────────
// Stargate V2
// ───────────────────────────────────────────────────────────────────────

export interface StargateAddresses {
  /** Stargate V2 Router contract address on this chain. */
  router: Address;
}

/**
 * Stargate V2 mainnet addresses.
 *
 * Router addresses from https://stargateprotocol.gitbook.io/stargate/v2/developers/contract-addresses
 */
export const STARGATE_MAINNET: Record<number, StargateAddresses> = {
  [ChainId.ETHEREUM_MAINNET]: {
    router: '0x9aA8E2114a6BC55e575B7c3D3f52F4f9035733d7' as Address,
  },
  [ChainId.ARBITRUM_ONE_MAINNET]: {
    router: '0x9aA8E2114a6BC55e575B7c3D3f52F4f9035733d7' as Address,
  },
  [ChainId.BASE_MAINNET]: {
    router: '0x9aA8E2114a6BC55e575B7c3D3f52F4f9035733d7' as Address,
  },
  [ChainId.BNB_CHAIN_MAINNET]: {
    router: '0x9aA8E2114a6BC55e575B7c3D3f52F4f9035733d7' as Address,
  },
};

/**
 * Stargate V2 testnet (Sepolia) addresses.
 *
 * Note: Stargate V2 testnet addresses may differ; these are placeholder
 * addresses for testnet integration testing.
 */
export const STARGATE_TESTNET: Record<number, StargateAddresses> = {
  [ChainId.ETHEREUM_TESTNET_SEPOLIA]: {
    router: '0x101F9565965De449D5ef3E3b915F4aB6cA0E5111' as Address,
  },
  [ChainId.ARBITRUM_ONE_SEPOLIA]: {
    router: '0x101F9565965De449D5ef3E3b915F4aB6cA0E5111' as Address,
  },
  [ChainId.BASE_SEPOLIA]: {
    router: '0x101F9565965De449D5ef3E3b915F4aB6cA0E5111' as Address,
  },
  [ChainId.BNB_CHAIN_TESTNET]: {
    router: '0x101F9565965De449D5ef3E3b915F4aB6cA0E5111' as Address,
  },
};

/**
 * Get Stargate V2 Router address for a given chain ID.
 */
export function getStargateAddresses(chainId: number): StargateAddresses {
  const mainnet = STARGATE_MAINNET[chainId];
  if (mainnet) {
    return mainnet;
  }

  const testnet = STARGATE_TESTNET[chainId];
  if (testnet) {
    return testnet;
  }

  throw new Error(`Stargate: no Router address for chainId ${chainId}`);
}

/**
 * Check if Stargate V2 supports a given chain pair.
 */
export function isStargateSupportedChainPair(
  sourceChainId: number,
  destinationChainId: number,
): boolean {
  const allAddresses = { ...STARGATE_MAINNET, ...STARGATE_TESTNET };
  return sourceChainId in allAddresses && destinationChainId in allAddresses;
}

// ───────────────────────────────────────────────────────────────────────
// Native / Canonical L2 Bridges
// ───────────────────────────────────────────────────────────────────────

/**
 * Native bridge type discriminator.
 * - 'arbitrum-inbox': Arbitrum canonical bridge (L1 Inbox depositEth)
 * - 'l1-standard-bridge': Optimism Standard Bridge on L1 (ETH→Base deposit)
 * - 'l2-standard-bridge': Optimism Standard Bridge on L2 (Base→ETH withdrawal)
 */
export type NativeBridgeType = 'arbitrum-inbox' | 'l1-standard-bridge' | 'l2-standard-bridge';

export interface NativeBridgeAddresses {
  /** Bridge contract address. */
  bridge: Address;
  /** Bridge type (determines ABI + method). */
  bridgeType: NativeBridgeType;
}

/**
 * Native bridge mainnet addresses.
 *
 * Arbitrum:
 *   - Inbox (Delayed Inbox on L1): https://docs.arbitrum.io/build-decentralized-apps/reference/contract-addresses
 *   - L2→L1 withdraws are initiated on Arbitrum L2 via ArbitrumBridge
 *
 * Base (Optimism stack):
 *   - L1StandardBridge: https://docs.optimism.io/builders/dapp-developers/bridge contracts
 *   - L2StandardBridge is always at 0x4200000000000000000000000000000000000010
 */
export const NATIVE_MAINNET: Record<string, NativeBridgeAddresses> = {
  // ETH → Arbitrum (L1 Inbox deposit)
  '1-42161': {
    bridge: '0x6c5c509c248a3bb1C32979b49ceC4ADa02F2D92F' as Address,
    bridgeType: 'arbitrum-inbox',
  },
  // Arbitrum → ETH (withdrawal initiated on L2 — tracked via gateway)
  '42161-1': {
    bridge: '0x0000000000000000000000000000000000000064' as Address, // Arbitrum L2 Outbox (pre-defined)
    bridgeType: 'arbitrum-inbox',
  },
  // ETH → Base (L1StandardBridge deposit)
  '1-8453': {
    bridge: '0x3154Cf16ccdb4C6d922629664174b904d80F2C35' as Address,
    bridgeType: 'l1-standard-bridge',
  },
  // Base → ETH (L2StandardBridge withdrawal)
  '8453-1': {
    bridge: '0x4200000000000000000000000000000000000010' as Address,
    bridgeType: 'l2-standard-bridge',
  },
};

/**
 * Native bridge testnet (Sepolia) addresses.
 *
 * Note: Testnet native bridges may use different/placeholder addresses.
 */
export const NATIVE_TESTNET: Record<string, NativeBridgeAddresses> = {
  // ETH Sepolia → Arbitrum Sepolia
  '11155111-421614': {
    bridge: '0x56d45f6E6679Eeb4a9c5b0D2C4e23B8a45a3e3D6' as Address,
    bridgeType: 'arbitrum-inbox',
  },
  // Arbitrum Sepolia → ETH Sepolia
  '421614-11155111': {
    bridge: '0x0000000000000000000000000000000000000064' as Address,
    bridgeType: 'arbitrum-inbox',
  },
  // ETH Sepolia → Base Sepolia
  '11155111-84532': {
    bridge: '0x16Fc5058F25648194471939df75CF27A2fdC48BC' as Address,
    bridgeType: 'l1-standard-bridge',
  },
  // Base Sepolia → ETH Sepolia
  '84532-11155111': {
    bridge: '0x4200000000000000000000000000000000000010' as Address,
    bridgeType: 'l2-standard-bridge',
  },
};

/**
 * Get native bridge addresses for a given chain pair.
 *
 * Key format: "{sourceChainId}-{destinationChainId}".
 */
export function getNativeBridgeAddresses(
  sourceChainId: number,
  destinationChainId: number,
): NativeBridgeAddresses {
  const key = `${sourceChainId}-${destinationChainId}`;

  const mainnet = NATIVE_MAINNET[key];
  if (mainnet) {
    return mainnet;
  }

  const testnet = NATIVE_TESTNET[key];
  if (testnet) {
    return testnet;
  }

  throw new Error(
    `Native bridge: no address for chain pair ${sourceChainId} → ${destinationChainId}`,
  );
}

/**
 * Check if native bridge supports a given chain pair.
 *
 * Native bridges only support L1↔L2 (Ethereum ↔ Arbitrum/Base).
 * L2↔L2 pairs (e.g. Arbitrum↔Base) require third-party bridges (Across/Stargate).
 */
export function isNativeSupportedChainPair(
  sourceChainId: number,
  destinationChainId: number,
): boolean {
  const key = `${sourceChainId}-${destinationChainId}`;
  return key in NATIVE_MAINNET || key in NATIVE_TESTNET;
}
