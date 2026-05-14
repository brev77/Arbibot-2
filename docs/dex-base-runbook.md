# DEX Base Chain Runbook

**Step:** DEX-1-4-BASE  
**Chain:** Base (mainnet: 8453, Sepolia testnet: 84532)  
**Status:** implemented

## Overview

Base is an Ethereum L2 built on the Optimism stack. Key DEX characteristics:

- **Primary venue:** Uniswap V3 (SwapRouter02)
- **UniV2:** NOT deployed on Base — adapter will reject with `unsupported chainId`
- **SushiSwap V2:** Deployed on Base mainnet only (not on Sepolia)
- **Gas:** L2 gas prices, typically < 0.001 USD per swap
- **Block time:** ~2 seconds

## Contract Addresses

### Base Mainnet (8453)

| Contract | Address |
|----------|---------|
| Uniswap V3 SwapRouter02 | `0x2626664c2603336E57B55794666850a4e5c3A2F6` |
| Uniswap V3 Factory | `0x33128a8fC17869897dcE68Ed026d594dd274D2f3` |
| SushiSwap V2 Router | `0x6BDED42c6DA8FBf0d2bA55B2fa120Ec19711BCee` |
| WETH | `0x4200000000000000000000000000000000000006` |
| USDC (native) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| USDT | `0xfdeBeC2fcC5819D3B0a2499F5CC2b2b2AA1a806e` |

### Base Sepolia Testnet (84532)

| Contract | Address |
|----------|---------|
| Uniswap V3 SwapRouter02 | `0x94cC0AaC5338A89d4C4A095063cEA4D13e00Cf42` |
| Uniswap V3 Factory | `0x1233427D9291214787Ee4c65a2a3a649a0A849E4` |
| WETH | `0x39B068B95720a4d9D492A6A41CF37E75D67DcE1D` |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

> **Note:** UniV2 and SushiSwap are NOT deployed on Base Sepolia (zero addresses).

## Environment Variables

```bash
# RPC endpoints
RPC_BASE_MAINNET_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
RPC_BASE_MAINNET_BACKUP_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_BACKUP_KEY  # optional
RPC_BASE_TESTNET_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY
RPC_BASE_TESTNET_BACKUP_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_BACKUP_KEY  # optional

# Gas policy (optional overrides)
GAS_POLICY_8453_MAX_FEE_GWEI=0.5
GAS_POLICY_8453_MAX_PRIORITY_FEE_GWEI=0.1
```

## Adapter Selection

On Base, the correct venue adapter depends on the target DEX:

| DEX | venueKey | Adapter | Notes |
|-----|----------|---------|-------|
| Uniswap V3 | `uniswap-v3` | `UniswapV3Adapter` | **Primary** — recommended for all Base swaps |
| SushiSwap V2 | `sushiswap-v2` | `SushiSwapV2Adapter` | Mainnet only — will throw on Sepolia |
| Uniswap V2 | `uniswap-v2` | `UniswapV2Adapter` | ❌ NOT available on Base |

## Playbook Config Example

```json
{
  "venueKey": "uniswap-v3",
  "dexSwaps": [
    {
      "venueKey": "uniswap-v3",
      "chainId": 8453,
      "tokenIn": "0x4200000000000000000000000000000000000006",
      "tokenOut": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "amountIn": "100000000000000000",
      "fee": 3000,
      "amountOutExpected": "180000000",
      "slippageBps": 50
    }
  ]
}
```

## Smoke Test

### Paper mode (default, no on-chain tx)

```bash
node tools/e2e-dex1-base-testnet.mjs
```

### Testnet mode (real Base Sepolia tx)

```bash
RPC_BASE_TESTNET_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY \
  node tools/e2e-dex1-base-testnet.mjs --testnet
```

### Prerequisites

- Running services: market-intake, opportunity, capital, execution-orchestrator
- Migrated database (migrations 001–035)
- For testnet: funded wallet on Base Sepolia with WETH approval

## Bug Fix (DEX-1-4-BASE)

**Fixed:** Base Sepolia chainId was incorrectly set to `84531` in several files.  
**Correct:** `84532` (ChainId.BASE_SEPOLIA in `@arbibot/contracts-eth`).

Files fixed:
- `rpc-provider-manager.service.ts` — RPC provider config
- `uniswap-v2.adapter.ts` — Base chain resolution
- `uniswap-v3.adapter.ts` — Base chain resolution
- `sushiswap-v2.adapter.ts` — Base chain resolution

## Monitoring

Key metrics for Base:

- `arb_dex_uniswap_v3_swap_total{chain_id="8453"}` — V3 swap count
- `arb_rpc_latency_seconds{chain_id="8453"}` — RPC latency
- `arb_rpc_failures_total{chain_id="8453"}` — RPC failures
- `arb_dex_gas_price_gwei{chain_id="8453"}` — Gas price

## Rollback

If Base chain support causes issues:

1. Set `RPC_BASE_MAINNET_URL` to empty — provider will skip initialization
2. Disable Base-specific routes in opportunity filters (`docs/dex-filters-config-keys.md`)
3. No database changes required for Base support

## References

- [Uniswap V3 Base deployments](https://docs.uniswap.org/contracts/v3/reference/deployments/base)
- [Base chain docs](https://docs.base.org/)
- [DEX testnet runbook](./dex-testnet-runbook.md)
- [DEX live mainnet runbook](./dex-live-mainnet-runbook.md)