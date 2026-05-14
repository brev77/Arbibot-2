# DEX-1-4-BNB: BNB Chain Runbook

## Overview

BNB Chain DEX integration for Arbibot 2 execution-orchestrator. Primary venue: **PancakeSwap V2**. Secondary venue: **Biswap V2** (mainnet only).

## Supported Chains

| Chain | chainId | Type | Venues |
|-------|---------|------|--------|
| BNB Chain Mainnet | 56 | Live | PancakeSwap V2, Biswap V2, SushiSwap |
| BNB Chain Testnet | 97 | Test | PancakeSwap V2 |

## Contract Addresses

### Mainnet (56)

| Contract | Address |
|----------|---------|
| PancakeSwap V2 Router | `0x10ED43C718714eb63d5aA57B78B54704E256024E` |
| PancakeSwap V2 Factory | `0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73` |
| Biswap V2 Router | `0x3a6d8cA8D9C0a3E4585c2a2c84D7A36e0301A4E` |
| Biswap V2 Factory | `0x858E3312ed3A876947AE49e6A8A2fA7A6b7819E8` |
| WBNB | `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` |
| USDT (BEP-20) | `0x55d398326f99059fF775485246999027B3197955` |
| USDC (BEP-20) | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` |

### Testnet (97)

| Contract | Address |
|----------|---------|
| PancakeSwap V2 Router | `0xD99D1c33F9fC3444f8101754aBC46c52416550D1` |
| PancakeSwap V2 Factory | `0x6725F303b657a9451d8BA641348b6761A6CC7a17` |
| WBNB | `0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd` |
| USDT (testnet) | `0x337610d27c682F34CbC18Be42BA2e79e04c15e35` |

> **Note:** Biswap is NOT deployed on BNB testnet. Use PancakeSwap V2 for testnet testing.

## Venue Keys

| Venue Key | Adapter | Description |
|-----------|---------|-------------|
| `pancakeswap-v2` | `PancakeSwapV2Adapter` | PancakeSwap V2 (Uniswap V2 fork) |
| `biswap` | `BiswapV2Adapter` | Biswap V2 (Uniswap V2 fork, mainnet only) |

## Environment Variables

```bash
# BNB Chain RPC endpoints
BNB_RPC_URL=https://bsc-dataseed.binance.org          # Mainnet
BNB_TESTNET_RPC_URL=https://data-seed-prebsc-1.binance.org:8545  # Testnet

# DEX execution
DEX_VENUE_ENABLED=true
DEX_WALLET_PRIVATE_KEY_<HEX_CHAIN_ID>=<encrypted-key>
```

## Adapter Details

### PancakeSwapV2Adapter

- **File:** `apps/execution-orchestrator/src/execution/adapters/pancakeswap-v2.adapter.ts`
- **Interface:** Uniswap V2 compatible (`swapExactTokensForTokens`)
- **Chains:** BNB mainnet (56), BNB testnet (97)
- **Metrics:**
  - `arb_dex_pancakeswap_v2_swap_total{chain_id, status}`
  - `arb_dex_pancakeswap_v2_swap_latency_seconds{chain_id}`

### BiswapV2Adapter

- **File:** `apps/execution-orchestrator/src/execution/adapters/biswap-v2.adapter.ts`
- **Interface:** Uniswap V2 compatible (`swapExactTokensForTokens`)
- **Chains:** BNB mainnet (56) only
- **Metrics:**
  - `arb_dex_biswap_v2_swap_total{chain_id, status}`
  - `arb_dex_biswap_v2_swap_latency_seconds{chain_id}`

## Playbook Config Example

```json
{
  "venueKey": "pancakeswap-v2",
  "dexSwaps": [
    {
      "venueKey": "pancakeswap-v2",
      "chainId": 56,
      "tokenIn": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
      "tokenOut": "0x55d398326f99059fF775485246999027B3197955",
      "amountIn": "1000000000000000000",
      "slippageBps": 50,
      "amountOutExpected": "600000000"
    }
  ]
}
```

## Smoke Test

```bash
# Paper mode (default, no on-chain tx)
node tools/e2e-dex1-bnb-testnet.mjs

# Testnet mode (requires RPC_BNB_TESTNET_URL + wallet)
node tools/e2e-dex1-bnb-testnet.mjs --testnet
```

## Operational Notes

1. **BNB gas model:** BNB Chain uses legacy gas pricing (not EIP-1559 by default). The adapters send type-2 (EIP-1559) transactions which are supported post-BNB Chain London upgrade.

2. **Slippage:** PancakeSwap/Biswap are Uniswap V2 forks — slippage is applied to `amountOutMin` via shared `applySlippage()` utility.

3. **Approval:** ERC20 approval is handled by `TokenApproveService` before each swap.

4. **Gas estimation:** Uses `GasEstimatorService` with chain-specific policies.

5. **Biswap limitation:** Biswap is mainnet-only. Attempting to use `biswap` venue key on testnet throws `VenueSubmitClientError`.

## Rollback

1. Set `DEX_VENUE_ENABLED=false` to disable all DEX adapters
2. Remove `pancakeswap-v2` / `biswap` from `venueKey` in playbook configs
3. Plans will fall back to `paper-dex` or `mock` adapter

## Related Documentation

- [`docs/dex-testnet-runbook.md`](dex-testnet-runbook.md) — Arbitrum testnet
- [`docs/dex-base-runbook.md`](dex-base-runbook.md) — Base deployment
- [`docs/dex-live-mainnet-runbook.md`](dex-live-mainnet-runbook.md) — Live mainnet
- [`packages/contracts-eth/src/addresses/bnb.ts`](../packages/contracts-eth/src/addresses/bnb.ts) — Address registry