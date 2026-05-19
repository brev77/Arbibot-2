/**
 * DEX utility functions for the operator dashboard.
 * Step: DEX-FE-P1 — chain metadata, explorer links, adapter display names.
 */

// ─── Chain metadata ─────────────────────────────────────────────────────────

export type ChainMeta = {
  readonly chainId: number;
  readonly name: string;
  readonly shortName: string;
  readonly color: string;
  readonly explorerTxUrl: string;
  readonly explorerAddressUrl: string;
};

const CHAINS: ReadonlyArray<ChainMeta> = [
  {
    chainId: 42161,
    name: 'Arbitrum One',
    shortName: 'Arbitrum',
    color: '#28A0F0',
    explorerTxUrl: 'https://arbiscan.io/tx/',
    explorerAddressUrl: 'https://arbiscan.io/address/',
  },
  {
    chainId: 421614,
    name: 'Arbitrum Sepolia',
    shortName: 'Arb-Sepolia',
    color: '#28A0F0',
    explorerTxUrl: 'https://sepolia.arbiscan.io/tx/',
    explorerAddressUrl: 'https://sepolia.arbiscan.io/address/',
  },
  {
    chainId: 8453,
    name: 'Base',
    shortName: 'Base',
    color: '#0052FF',
    explorerTxUrl: 'https://basescan.org/tx/',
    explorerAddressUrl: 'https://basescan.org/address/',
  },
  {
    chainId: 84532,
    name: 'Base Sepolia',
    shortName: 'Base-Sepolia',
    color: '#0052FF',
    explorerTxUrl: 'https://sepolia.basescan.org/tx/',
    explorerAddressUrl: 'https://sepolia.basescan.org/address/',
  },
  {
    chainId: 56,
    name: 'BNB Chain',
    shortName: 'BNB',
    color: '#F3BA2F',
    explorerTxUrl: 'https://bscscan.com/tx/',
    explorerAddressUrl: 'https://bscscan.com/address/',
  },
  {
    chainId: 97,
    name: 'BNB Testnet',
    shortName: 'BNB-Test',
    color: '#F3BA2F',
    explorerTxUrl: 'https://testnet.bscscan.com/tx/',
    explorerAddressUrl: 'https://testnet.bscscan.com/address/',
  },
];

const chainById = new Map(CHAINS.map((c) => [c.chainId, c] as const));

/** Get chain metadata by chainId, or `null` if unknown. */
export function getChainMeta(chainId: number | null): ChainMeta | null {
  if (chainId === null) return null;
  return chainById.get(chainId) ?? null;
}

/** Build full block explorer tx URL. */
export function getExplorerTxUrl(chainId: number | null, txHash: string): string {
  const meta = getChainMeta(chainId);
  if (meta === null) return '';
  return `${meta.explorerTxUrl}${txHash}`;
}

/** Build full block explorer address URL. */
export function getExplorerAddressUrl(chainId: number | null, address: string): string {
  const meta = getChainMeta(chainId);
  if (meta === null) return '';
  return `${meta.explorerAddressUrl}${address}`;
}

// ─── DEX adapter display names ──────────────────────────────────────────────

const ADAPTER_NAMES: Readonly<Record<string, string>> = {
  uniV2: 'Uniswap V2',
  uniV3: 'Uniswap V3',
  sushi: 'SushiSwap',
  pancakeV2: 'PancakeSwap V2',
  biswapV2: 'Biswap V2',
};

/** Get human-readable DEX adapter name. */
export function getAdapterDisplayName(key: string | null): string {
  if (key === null) return '—';
  return ADAPTER_NAMES[key] ?? key;
}

// ─── Badge styling helpers ──────────────────────────────────────────────────

export type TxStatusBadge = {
  readonly label: string;
  readonly bg: string;
  readonly text: string;
};

/** Get badge style for on-chain tx status. */
export function getTxStatusBadge(status: string | null): TxStatusBadge {
  switch (status) {
    case 'confirmed':
      return { label: 'Confirmed', bg: '#064e3b', text: '#6ee7b7' };
    case 'pending':
      return { label: 'Pending', bg: '#713f12', text: '#fcd34d' };
    case 'failed':
      return { label: 'Failed', bg: '#7f1d1d', text: '#fca5a5' };
    case 'reverted':
      return { label: 'Reverted', bg: '#7c2d12', text: '#fdba74' };
    default:
      return { label: '—', bg: '#1e293b', text: '#94a3b8' };
  }
}

/** Get badge style for venue type. */
export function getVenueBadge(venueType: string | null): TxStatusBadge {
  switch (venueType) {
    case 'dex':
      return { label: 'DEX', bg: '#581c87', text: '#d8b4fe' };
    case 'http':
      return { label: 'HTTP', bg: '#1e293b', text: '#94a3b8' };
    default:
      return { label: '—', bg: '#1e293b', text: '#64748b' };
  }
}

/** Format gas (wei string) to a readable ETH value. */
export function formatGasEth(gasWei: string | null): string {
  if (gasWei === null) return '—';
  try {
    const wei = BigInt(gasWei);
    if (wei === BigInt(0)) return '0';
    const eth = Number(wei) / 1e18;
    if (eth < 0.0001) return `<0.0001`;
    return `${eth.toFixed(4)} ETH`;
  } catch {
    return '—';
  }
}

/** Truncate an address or hash for display. */
export function truncateHash(hash: string | null, head = 6, tail = 4): string {
  if (hash === null) return '—';
  if (hash.length <= head + tail + 3) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}