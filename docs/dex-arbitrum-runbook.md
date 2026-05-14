# DEX-1-4-ARBITRUM: Arbitrum Chain Runbook

## Overview

Arbitrum DEX integration for Arbibot 2 execution-orchestrator. Three venues supported: **Uniswap V2**, **Uniswap V3** (primary), and **SushiSwap**.

## Supported Chains

| Chain | chainId | Type | Venues |
|-------|---------|------|--------|
| Arbitrum One Mainnet | 42161 | Live | Uniswap V2, Uniswap V3, SushiSwap |
| Arbitrum Sepolia Testnet | 421614 | Test | Uniswap V2, Uniswap V3, SushiSwap |

## Contract Addresses

### Mainnet (42161)

| Contract | Address |
|----------|---------|
| Uniswap V2 Router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` |
| Uniswap V2 Factory | `0xf1D7CC64Fb745938252F3B21e12e7C8398cE848e` |
| Uniswap V3 SwapRouter | `0xE592427A0AEce92De3Edee1F18E0157C05861564` |
| Uniswap V3 Factory | `0x1F98431c8aD98523631AE4a59f267346ea31F984` |
| SushiSwap Router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` |
| SushiSwap Factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` |
| WETH | `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` |
| USDC | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| USDT | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` |

### Testnet / Sepolia (421614)

| Contract | Address |
|----------|---------|
| Uniswap V2 Router | `0x4752ba5dbc23f44d87826276bf6fd6b6c874abfc` |
| Uniswap V2 Factory | `0xd1F20C1c6864211b0Ce7b6AdF4d82E5B85cAb2c0` |
| Uniswap V3 SwapRouter | `0x3bFA4769FB09eefC5a80d58Ea2719aF8D5Be33b0` |
| Uniswap V3 Factory | `0x31e2a1d903E458bB0F7770965e6d8211f2348919` |
| SushiSwap Router | `0x4752ba5dbc23f44d87826276bf6fd6b6c874abfc` |
| SushiSwap Factory | `0xd1F20C1c6864211b0Ce7b6AdF4d82E5B85cAb2c0` |
| WETH | `0x4200000000000000000000000000000000000006` |
| USDC | `0x75faf114eafb1acbe2a3976482854f7f230fa178` |
| USDT | `0x319c9e4a6554Ae6e5D75979e9d009D84B6Fb53f6` |

## Venue Keys

| Venue Key | Adapter | Description |
|-----------|---------|-------------|
| `uniswap-v2` | `UniswapV2Adapter` | Uniswap V2 (swapExactTokensForTokens) |
| `uniswap-v3` | `UniswapV3Adapter` | Uniswap V3 (exactInputSingle) — **primary** |
| `sushiswap-v2` | `SushiSwapV2Adapter` | SushiSwap (Uniswap V2 fork) |

## Environment Variables

```bash
# Arbitrum RPC endpoints
ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc                    # Mainnet
ARBITRUM_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc  # Testnet

# DEX execution
DEX_VENUE_ENABLED=true
DEX_WALLET_PRIVATE_KEY_<HEX_CHAIN_ID>=<encrypted-key>
```

## Adapter Details

### UniswapV2Adapter

- **File:** `apps/execution-orchestrator/src/execution/adapters/uniswap-v2.adapter.ts`
- **Interface:** `swapExactTokensForTokens`
- **Chains:** Arbitrum mainnet (42161), Arbitrum Sepolia (421614)
- **Metrics:**
  - `arb_dex_uniswap_v2_swap_total{chain_id, status}`
  - `arb_dex_uniswap_v2_swap_latency_seconds{chain_id}`

### UniswapV3Adapter

- **File:** `apps/execution-orchestrator/src/execution/adapters/uniswap-v3.adapter.ts`
- **Interface:** `exactInputSingle` via SwapRouter
- **Chains:** Arbitrum mainnet (42161), Arbitrum Sepolia (421614)
- **Primary venue on Arbitrum** — deepest liquidity
- **Metrics:**
  - `arb_dex_uniswap_v3_swap_total{chain_id, status}`
  - `arb_dex_uniswap_v3_swap_latency_seconds{chain_id}`

### SushiSwapV2Adapter

- **File:** `apps/execution-orchestrator/src/execution/adapters/sushiswap-v2.adapter.ts`
- **Interface:** `swapExactTokensForTokens` (Uniswap V2 fork)
- **Chains:** Arbitrum mainnet (42161), Arbitrum Sepolia (421614)
- **Metrics:**
  - `arb_dex_sushiswap_v2_swap_total{chain_id, status}`
  - `arb_dex_sushiswap_v2_swap_latency_seconds{chain_id}`

## Playbook Config Examples

### Uniswap V3 (primary)

```json
{
  "venueKey": "uniswap-v3",
  "dexSwaps": [
    {
      "venueKey": "uniswap-v3",
      "chainId": 42161,
      "tokenIn": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
      "tokenOut": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      "amountIn": "1000000000000000000",
      "slippageBps": 50,
      "fee": 3000,
      "amountOutExpected": "600000000"
    }
  ]
}
```

### Uniswap V2 / SushiSwap

```json
{
  "venueKey": "uniswap-v2",
  "dexSwaps": [
    {
      "venueKey": "uniswap-v2",
      "chainId": 42161,
      "tokenIn": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
      "tokenOut": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
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
node tools/e2e-dex1-arbitrum-testnet.mjs

# Specific adapter (paper mode)
node tools/e2e-dex1-arbitrum-testnet.mjs --uni-v3
node tools/e2e-dex1-arbitrum-testnet.mjs --uni-v2
node tools/e2e-dex1-arbitrum-testnet.mjs --sushi

# Testnet mode (requires RPC_ARBITRUM_TESTNET_URL + wallet)
node tools/e2e-dex1-arbitrum-testnet.mjs --testnet --uni-v3
```

## Operational Notes

1. **Arbitrum gas model:** Arbitrum uses EIP-1559 with L1 data fee. Gas estimation includes both L2 gas and L1 calldata cost.

2. **Primary venue:** Uniswap V3 is the primary DEX on Arbitrum with deepest liquidity. Use UniV2/Sushi only when V3 pool doesn't exist for the pair.

3. **Slippage:** V2 adapters apply slippage to `amountOutMin`; V3 adapter uses `sqrtPriceLimitX96` and `amountOutMinimum`.

4. **Approval:** ERC20 approval via `TokenApproveService` before each swap.

5. **L1 fee:** Arbitrum transactions incur L1 data posting fees — monitor `arb_dex_gas_cost_eth` for total cost.

6. **Confirmations:** Arbitrum blocks are fast (~0.25s). Use 1 confirmation for most trades; 10+ for large notional.

## Rollback

1. Set `DEX_VENUE_ENABLED=false` to disable all DEX adapters
2. Remove venue key from playbook configs
3. Plans will fall back to `paper-dex` or `mock` adapter

## Related Documentation

- [`docs/dex-testnet-runbook.md`](dex-testnet-runbook.md) — Generic testnet runbook
- [`docs/dex-base-runbook.md`](dex-base-runbook.md) — Base deployment
- [`docs/dex-bnb-runbook.md`](dex-bnb-runbook.md) — BNB Chain deployment
- [`docs/dex-live-mainnet-runbook.md`](dex-live-mainnet-runbook.md) — Live mainnet
- [`packages/contracts-eth/src/addresses/arbitrum.ts`](../packages/contracts-eth/src/addresses/arbitrum.ts) — Address registry