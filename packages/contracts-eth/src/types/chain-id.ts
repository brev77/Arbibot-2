/**
 * Supported EVM chain IDs for DEX trading
 */
export enum ChainId {
  // Ethereum
  ETHEREUM_MAINNET = 1,
  ETHEREUM_TESTNET_SEPOLIA = 11155111,

  // Arbitrum
  ARBITRUM_ONE_MAINNET = 42161,
  ARBITRUM_ONE_SEPOLIA = 421614,

  // Base
  BASE_MAINNET = 8453,
  BASE_SEPOLIA = 84532,

  // BNB Chain
  BNB_CHAIN_MAINNET = 56,
  BNB_CHAIN_TESTNET = 97,
}

/**
 * Chain ID to name mapping
 */
export const CHAIN_ID_TO_NAME: Record<ChainId, string> = {
  [ChainId.ETHEREUM_MAINNET]: 'Ethereum Mainnet',
  [ChainId.ETHEREUM_TESTNET_SEPOLIA]: 'Ethereum Sepolia Testnet',
  [ChainId.ARBITRUM_ONE_MAINNET]: 'Arbitrum One Mainnet',
  [ChainId.ARBITRUM_ONE_SEPOLIA]: 'Arbitrum One Sepolia Testnet',
  [ChainId.BASE_MAINNET]: 'Base Mainnet',
  [ChainId.BASE_SEPOLIA]: 'Base Sepolia Testnet',
  [ChainId.BNB_CHAIN_MAINNET]: 'BNB Chain Mainnet',
  [ChainId.BNB_CHAIN_TESTNET]: 'BNB Chain Testnet',
};

/**
 * Chain ID to explorer URL mapping
 */
export const CHAIN_ID_TO_EXPLORER: Record<ChainId, string> = {
  [ChainId.ETHEREUM_MAINNET]: 'https://etherscan.io',
  [ChainId.ETHEREUM_TESTNET_SEPOLIA]: 'https://sepolia.etherscan.io',
  [ChainId.ARBITRUM_ONE_MAINNET]: 'https://arbiscan.io',
  [ChainId.ARBITRUM_ONE_SEPOLIA]: 'https://sepolia.arbiscan.io',
  [ChainId.BASE_MAINNET]: 'https://basescan.org',
  [ChainId.BASE_SEPOLIA]: 'https://sepolia.basescan.org',
  [ChainId.BNB_CHAIN_MAINNET]: 'https://bscscan.com',
  [ChainId.BNB_CHAIN_TESTNET]: 'https://testnet.bscscan.com',
};

/**
 * Get chain name by chain ID
 */
export function getChainName(chainId: ChainId): string {
  return CHAIN_ID_TO_NAME[chainId] || `Chain ${chainId}`;
}

/**
 * Get explorer URL by chain ID
 */
export function getExplorerUrl(chainId: ChainId): string {
  return CHAIN_ID_TO_EXPLORER[chainId] || '';
}

/**
 * Get transaction URL for a chain
 */
export function getTransactionUrl(chainId: ChainId, txHash: string): string {
  const baseUrl = getExplorerUrl(chainId);
  return baseUrl ? `${baseUrl}/tx/${txHash}` : '';
}

/**
 * Get address URL for a chain
 */
export function getAddressUrl(chainId: ChainId, address: string): string {
  const baseUrl = getExplorerUrl(chainId);
  return baseUrl ? `${baseUrl}/address/${address}` : '';
}

/**
 * Check if chain ID is a mainnet
 */
export function isMainnet(chainId: ChainId): boolean {
  return [
    ChainId.ETHEREUM_MAINNET,
    ChainId.ARBITRUM_ONE_MAINNET,
    ChainId.BASE_MAINNET,
    ChainId.BNB_CHAIN_MAINNET,
  ].includes(chainId);
}

/**
 * Check if chain ID is a testnet
 */
export function isTestnet(chainId: ChainId): boolean {
  return !isMainnet(chainId);
}

// ───────────────────────────────────────────────────────────────────────
// Finality thresholds (D4-B-5-BRIDGE, L5)
// ───────────────────────────────────────────────────────────────────────
//
// Chain-specific required confirmations for considering a transaction "final"
// (reorg-safe). Used by BridgeFinalityService for source-chain finality before
// destination delivery verification, and snapshotted onto bridge_transfers.
//
// Values reflect conservative reorg-safety thresholds:
//   - Ethereum mainnet: 12 blocks (~2.5 min) — strong reorg safety.
//   - L2 rollups (Arbitrum, Base): 1 confirmation — sequencer finality; the L1
//     data-availability layer makes deep reorgs economically infeasible.
//   - BNB Chain mainnet: 15 blocks (~45 s) — higher reorg risk, conservative.
//   - Testnets (Sepolia family): 3 blocks — fast iteration, low-value traffic.
//
// Operators may OVERRIDE (tighten only) via the BRIDGE_FINALITY_CONFIRMATIONS
// env var (JSON map of chainId → confirmations), parsed fail-closed by the
// consumer (BridgeFinalityService): on parse error the defaults below are used.

/**
 * Default required confirmations per chain ID (mainnet + testnet).
 */
export const CHAIN_FINALITY_CONFIRMATIONS: Readonly<Record<number, number>> = {
  // Ethereum
  [ChainId.ETHEREUM_MAINNET]: 12,
  [ChainId.ETHEREUM_TESTNET_SEPOLIA]: 3,

  // L2 rollups — sequencer finality
  [ChainId.ARBITRUM_ONE_MAINNET]: 1,
  [ChainId.ARBITRUM_ONE_SEPOLIA]: 1,
  [ChainId.BASE_MAINNET]: 1,
  [ChainId.BASE_SEPOLIA]: 1,

  // BNB Chain — higher reorg risk
  [ChainId.BNB_CHAIN_MAINNET]: 15,
  [ChainId.BNB_CHAIN_TESTNET]: 3,
};

/** Safe default when a chain ID is not in the map (unknown chain → conservative). */
export const DEFAULT_FINALITY_CONFIRMATIONS = 12;

/**
 * Get the required number of confirmations for a chain ID.
 *
 * Returns the chain-specific threshold from CHAIN_FINALITY_CONFIRMATIONS, or
 * the conservative DEFAULT_FINALITY_CONFIRMATIONS for unknown chains.
 */
export function getRequiredConfirmations(chainId: number): number {
  return CHAIN_FINALITY_CONFIRMATIONS[chainId] ?? DEFAULT_FINALITY_CONFIRMATIONS;
}