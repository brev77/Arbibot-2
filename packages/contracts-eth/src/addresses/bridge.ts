import { Address } from '../types/address';
import { ChainId, isMainnet } from '../types/chain-id';

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
    spokePool: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
  },
  [ChainId.ARBITRUM_ONE_MAINNET]: {
    spokePool: '0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A',
  },
  [ChainId.BASE_MAINNET]: {
    spokePool: '0x09aea4b2242abC8bb4BB78D537A67a245a7bEC64',
  },
};

/**
 * Across testnet (Sepolia) addresses.
 */
export const ACROSS_TESTNET: Record<number, AcrossAddresses> = {
  [ChainId.ETHEREUM_TESTNET_SEPOLIA]: {
    spokePool: '0x5ef6C01E11839d1B5F5146a3cF26a90e2b5B3C81',
  },
  [ChainId.ARBITRUM_ONE_SEPOLIA]: {
    spokePool: '0x60AbD308cCEE43443b12B02De943B3E3abD3DB21',
  },
  [ChainId.BASE_SEPOLIA]: {
    spokePool: '0x03f78791E7a2f21ca2a792cb12C24Fba6E07EfbC',
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
    router: '0x9aA8E2114a6BC55e575B7c3D3f52F4f9035733d7',
  },
  [ChainId.ARBITRUM_ONE_MAINNET]: {
    router: '0x9aA8E2114a6BC55e575B7c3D3f52F4f9035733d7',
  },
  [ChainId.BASE_MAINNET]: {
    router: '0x9aA8E2114a6BC55e575B7c3D3f52F4f9035733d7',
  },
  [ChainId.BNB_CHAIN_MAINNET]: {
    router: '0x9aA8E2114a6BC55e575B7c3D3f52F4f9035733d7',
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
    router: '0x101F9565965De449D5ef3E3b915F4aB6cA0E5111',
  },
  [ChainId.ARBITRUM_ONE_SEPOLIA]: {
    router: '0x101F9565965De449D5ef3E3b915F4aB6cA0E5111',
  },
  [ChainId.BASE_SEPOLIA]: {
    router: '0x101F9565965De449D5ef3E3b915F4aB6cA0E5111',
  },
  [ChainId.BNB_CHAIN_TESTNET]: {
    router: '0x101F9565965De449D5ef3E3b915F4aB6cA0E5111',
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
// LayerZero V2 Endpoint (D4-B-5-BRIDGE, L5)
// ───────────────────────────────────────────────────────────────────────
//
// The LayerZero V2 Endpoint is deployed at the SAME canonical address on every
// supported EVM chain (mainnet). Used to verify Stargate swap delivery via
// `delivered(guid)`. Stargate messages are dispatched through this endpoint.
//
// Reference: https://docs.layerzero.network/v2/deployments/deployed-contracts
export const LAYERZERO_ENDPOINT_V2: Address = '0x1a44076050125825900e736c501f859c50fE728c';

/** Testnet (Sepolia) LayerZero V2 Endpoint — used for testnet Stargate verification. */
export const LAYERZERO_ENDPOINT_V2_TESTNET: Address = '0x6EDCE65403992e310A62460808c4b910D972f10f';

/**
 * Resolve the LayerZero V2 Endpoint address for a chain ID.
 *
 * Returns the canonical mainnet endpoint for mainnet chains, the Sepolia endpoint
 * for testnet chains (Ethereum/Arbitrum/Base Sepolia). Throws for unknown chains.
 */
export function getLayerZeroEndpoint(chainId: number): Address {
  if (isMainnet(chainId)) {
    return LAYERZERO_ENDPOINT_V2;
  }
  // Sepolia-family testnets share a testnet endpoint deployment.
  const testnetChains = [
    ChainId.ETHEREUM_TESTNET_SEPOLIA,
    ChainId.ARBITRUM_ONE_SEPOLIA,
    ChainId.BASE_SEPOLIA,
    ChainId.BNB_CHAIN_TESTNET,
  ];
  if (testnetChains.includes(chainId)) {
    return LAYERZERO_ENDPOINT_V2_TESTNET;
  }
  throw new Error(`LayerZero V2: no Endpoint address for chainId ${chainId}`);
}

// ───────────────────────────────────────────────────────────────────────
// Native / Canonical L2 Bridges
// ───────────────────────────────────────────────────────────────────────

/**
 * Native bridge type discriminator.
 * - 'arbitrum-inbox': Arbitrum canonical bridge (L1 Inbox depositEth) — L1→L2
 * - 'arbitrum-outbox': Arbitrum canonical bridge (L1 Outbox) — L2→L1 withdrawal finalization
 * - 'l1-standard-bridge': Optimism Standard Bridge on L1 (ETH→Base deposit)
 * - 'l2-standard-bridge': Optimism Standard Bridge on L2 (Base→ETH withdrawal)
 */
export type NativeBridgeType =
  | 'arbitrum-inbox'
  | 'arbitrum-outbox'
  | 'l1-standard-bridge'
  | 'l2-standard-bridge';

export interface NativeBridgeAddresses {
  /** Bridge contract address (initiation side: Inbox / L1StandardBridge / L2StandardBridge). */
  bridge: Address;
  /** Bridge type (determines ABI + method). */
  bridgeType: NativeBridgeType;
  /** L1 Outbox address (Arbitrum L2→L1 finalization, D4-B-5-BRIDGE). Only for arbitrum-outbox. */
  outbox?: Address;
  /** L1 OptimismPortal address (OP L2→L1 finalization, D4-B-5-BRIDGE). Only for l2-standard-bridge. */
  optimismPortal?: Address;
  /** L2 L2ToL1MessagePasser predeploy (OP L2→L1 withdrawal hash source). Only for l2-standard-bridge. */
  l2ToL1MessagePasser?: Address;
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
    bridge: '0x6c5c509c248a3bb1C32979b49ceC4ADa02F2D92F',
    bridgeType: 'arbitrum-inbox',
  },
  // Arbitrum → ETH (L2→L1 withdrawal; initiated on L2, finalized via L1 Outbox)
  '42161-1': {
    bridge: '0x0000000000000000000000000000000000000064', // Arbitrum L2 Outbox system precompile (L2 side)
    bridgeType: 'arbitrum-outbox',
    outbox: '0x667e23abD27e623C11D4cc00Ca3eC4D0bd63337a', // L1 Outbox — executeTransaction / outboxEntryExists
  },
  // ETH → Base (L1StandardBridge deposit)
  '1-8453': {
    bridge: '0x3154Cf16ccdb4C6d922629664174b904d80F2C35',
    bridgeType: 'l1-standard-bridge',
  },
  // Base → ETH (L2StandardBridge withdrawal; finalized via L1 OptimismPortal after 7-day window)
  '8453-1': {
    bridge: '0x4200000000000000000000000000000000000010',
    bridgeType: 'l2-standard-bridge',
    optimismPortal: '0xbEb5Fc579115071764c7423A4fB5eD9aB6d3C91E', // L1 OptimismPortal (Base)
    l2ToL1MessagePasser: '0x4200000000000000000000000000000000000016', // Base L2 predeploy
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
    bridge: '0x56d45f6E6679Eeb4a9c5b0D2C4e23B8a45a3e3D6',
    bridgeType: 'arbitrum-inbox',
  },
  // Arbitrum Sepolia → ETH Sepolia (L2→L1; outbox address not configured for testnet →
  // adapter holds 'confirming' until operator manual completion per runbook B1)
  '421614-11155111': {
    bridge: '0x0000000000000000000000000000000000000064',
    bridgeType: 'arbitrum-outbox',
  },
  // ETH Sepolia → Base Sepolia
  '11155111-84532': {
    bridge: '0x16Fc5058F25648194471939df75CF27A2fdC48BC',
    bridgeType: 'l1-standard-bridge',
  },
  // Base Sepolia → ETH Sepolia (L2StandardBridge withdrawal; testnet OptimismPortal
  // address not pinned — adapter holds 'confirming' until operator manual completion)
  '84532-11155111': {
    bridge: '0x4200000000000000000000000000000000000010',
    bridgeType: 'l2-standard-bridge',
    l2ToL1MessagePasser: '0x4200000000000000000000000000000000000016', // Base Sepolia L2 predeploy
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
