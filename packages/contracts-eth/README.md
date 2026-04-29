# @arbibot/contracts-eth

EVM-specific contracts, ABIs, and addresses for DEX trading in Arbibot 2.

## Purpose

This package provides:
- Type-safe EVM chain IDs and address types
- DEX router ABIs (Uniswap V2/V3, SushiSwap)
- ERC20 token ABI (for approve/allowance checks)
- Contract addresses for supported networks (Arbitrum, Base, BNB Chain)

## Installation

This package is part of the Arbibot 2 monorepo and should not be installed separately.

## Supported Chains

### Arbitrum
- **Mainnet**: Chain ID 42161
- **Sepolia Testnet**: Chain ID 421614

### Base (Coming Soon)
- **Mainnet**: Chain ID 8453
- **Sepolia Testnet**: Chain ID 84532

### BNB Chain (Coming Soon)
- **Mainnet**: Chain ID 56
- **Testnet**: Chain ID 97

## Usage

```typescript
import {
  ChainId,
  getChainName,
  getExplorerUrl,
  Address,
  isValidAddress,
  UniswapV2RouterABI,
  ERC20ABI,
  getArbitrumAddresses,
} from '@arbibot/contracts-eth';
```

### Chain ID

```typescript
// Get chain name
const name = getChainName(ChainId.ARBITRUM_ONE_MAINNET);
// Returns: "Arbitrum One Mainnet"

// Get explorer URL
const url = getExplorerUrl(ChainId.ARBITRUM_ONE_MAINNET);
// Returns: "https://arbiscan.io"

// Check if mainnet/testnet
isMainnet(ChainId.ARBITRUM_ONE_MAINNET); // true
isTestnet(ChainId.ARBITRUM_ONE_SEPOLIA); // true
```

### Address Type

```typescript
import { Address, isValidAddress, assertValidAddress, normalizeAddress, isSameAddress } from '@arbibot/contracts-eth';

// Type-safe address
const address: Address = '0x1234...';

// Validate
if (isValidAddress(someString)) {
  const addr: Address = someString;
}

// Assert (throws if invalid)
const addr = assertValidAddress('0x1234...');

// Normalize to lowercase
const normalized = normalizeAddress(address);

// Compare addresses
const same = isSameAddress('0xAbc...', '0xabc...'); // true (case-insensitive)
```

### DEX Addresses

```typescript
import { getArbitrumAddresses, ChainId } from '@arbibot/contracts-eth';

const addresses = getArbitrumAddresses(ChainId.ARBITRUM_ONE_MAINNET);

console.log(addresses.uniswapV2Router);
console.log(addresses.weth);
console.log(addresses.usdc);
```

### ABIs

```typescript
import { UniswapV2RouterABI, ERC20ABI } from '@arbibot/contracts-eth';
import { Contract } from 'ethers';

const router = new Contract(routerAddress, UniswapV2RouterABI, provider);
const token = new Contract(tokenAddress, ERC20ABI, provider);
```

## Architecture Compliance

This package follows Arbibot 2 architecture principles:
- **Single source of truth**: All DEX addresses are centralized here
- **Type safety**: Uses TypeScript strict mode with no `any`
- **No external state**: Pure functions and constants
- **Zero runtime dependencies**: Only TypeScript types

## Development

```bash
# Build
npm run build -w @arbibot/contracts-eth

# Lint
npm run lint -w @arbibot/contracts-eth

# Test
npm run test -w @arbibot/contracts-eth
```

## Adding New Chains

1. Add chain ID enum value in `src/types/chain-id.ts`
2. Add chain name, explorer URL mappings
3. Create `src/addresses/<chain>.ts` with addresses
4. Export from `src/index.ts`
5. Update this README

## Adding New DEXes

1. Create ABI file in `src/abis/<dex>-router.ts`
2. Add router/factory addresses to chain-specific files
3. Export from `src/index.ts`
4. Update this README

## Security Notes

- All addresses are verified against official DEX documentation
- Testnet addresses are separated from mainnet
- Zero-address constant is provided for safety checks

## Related Documentation

- [DEX Development Plan](../../.cursor/plans/DEVELOPMENT_PLAN-DEX.md)
- [Architecture Invariants](../../docs/handbook/02-architecture-invariants.md)
- [Architecture Rules](../../.cursor/rules/arbibot-project.mdc)