# DEX MEV Threats and Countermeasures

**Step:** DEX-1-2-MEMPOOL  
**Last updated:** 2026-05-10

## Overview

This document describes MEV (Maximal Extractable Value) threats relevant to DEX arbitrage execution in Arbibot 2, and the countermeasures implemented.

## Threat Model

### 1. Frontrunning

**Description:** An attacker observes a pending swap transaction in the mempool and submits their own transaction for the same token pair with a higher gas price, getting executed first.

**Impact:**
- Slippage increase on our swap
- Reduced profit or loss on the arbitrage leg
- Price moves against us before our tx confirms

**Detection heuristic:**
- Pending tx for same token pair with gas price > threshold (default: 500 bps = 5% above ours)
- Same DEX router address
- Same direction (tokenIn → tokenOut)

**Countermeasures:**
- **Gas boosting:** Increase gas price dynamically when MEV detected (`GasEstimatorService` + `SlippageProtectionService`)
- **Private mempool:** Submit via private RPC endpoints (Flashbots Protect, MEV Blocker) — bypasses public mempool
- **MEV risk check:** `DexMempoolMonitorWorker.checkMevRisk()` returns `riskLevel: 'medium' | 'high'` — execution pipeline can delay or abort
- **Slippage tolerance:** `SlippageProtectionService` enforces minimum `amountOut` thresholds

### 2. Sandwich Attack

**Description:** An attacker wraps our transaction with two of their own:
1. **Frontrun buy:** Buys the same token before us (pushing price up)
2. **Backrun sell:** Sells immediately after our buy (pushing price back down)

**Impact:**
- We buy at inflated price
- Attacker profits from the price difference
- Can eliminate arbitrage profit entirely

**Detection heuristic:**
- Pending tx in same direction with higher gas (frontrun leg)
- Pending tx in reverse direction timed after frontrun (backrun leg)
- Same token pair, same DEX router

**Countermeasures:**
- **Same as frontrunning** plus:
- **Commit-reveal schemes:** Not currently implemented (future consideration)
- **Batch auctions:** Not applicable for real-time arbitrage
- **Delay execution:** When sandwich detected (`riskLevel: 'high'`), abort or delay the swap

### 3. Backrunning

**Description:** An attacker monitors our swap and immediately trades after it, profiting from the price impact we created.

**Impact:**
- Less severe than frontrunning/sandwich
- Can affect multi-leg arbitrage where subsequent legs face worse prices

**Detection heuristic:**
- Pending tx for same pair with significantly lower gas price (< -200 bps)
- Same direction, following our transaction

**Countermeasures:**
- **Fast execution:** Minimize time between legs in multi-leg arbitrage
- **Price impact limits:** `DexRiskPolicyService` enforces max position sizes

### 4. Just-in-Time (JIT) Liquidity

**Description:** An LP observer sees a large pending swap and adds concentrated liquidity around the current price just before the swap executes, then removes it immediately after.

**Impact:**
- Large swaps get filled at slightly worse prices
- LP captures most of the fee that should go to permanent LPs

**Countermeasures:**
- **Split large orders:** Break large swaps into smaller chunks
- **Price impact monitoring:** `DexRiskPolicyService` volume checks

## Prometheus Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `arb_dex_mev_detected_total` | Counter | `type` (frontrun/sandwich/backrun), `chain_id` | Total MEV threats detected |
| `arb_dex_mempool_pending_swaps` | Gauge | `chain_id` | Current pending DEX swaps tracked |

### Example queries

```promql
# MEV detection rate (per minute)
rate(arb_dex_mev_detected_total[5m]) * 60

# Sandwich attacks by chain
arb_dex_mev_detected_total{type="sandwich"}

# Pending mempool activity
arb_dex_mempool_pending_swaps
```

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `DEX_MEMPOOL_ENABLED` | `false` | Enable mempool monitoring |
| `DEX_MEMPOOL_CHAIN_IDS` | `42161` | Chain IDs to monitor |
| `DEX_MEMPOOL_ROUTER_ADDRESSES` | Arbitrum routers | DEX router addresses to watch |
| `DEX_MEMPOOL_ANALYSIS_WINDOW_MS` | `30000` | Time window for pending swap tracking |
| `DEX_MEMPOOL_FRONTRUN_GAS_PREMIUM_BPS` | `500` | Gas premium threshold for frontrun detection |
| `DEX_MEMPOOL_MAX_PENDING` | `500` | Max pending swaps per chain |

## Architecture Notes

- **Read-only:** `DexMempoolMonitorWorker` does not modify execution state
- **Heuristic-based:** Detection uses gas price comparison and pattern matching; false positives are possible
- **Sliding window:** Old pending swaps are cleaned up every 10 seconds
- **Per-chain isolation:** Threats on one chain do not affect risk assessment on another
- **Calldata decoding:** Supports Uniswap V2/V3 and SushiSwap function selectors for token pair extraction

## Future Considerations

1. **Private mempool integration** (Flashbots Protect, MEV Blocker RPC)
2. **Machine learning** for MEV pattern classification
3. **Cross-chain MEV** (bridge frontrunning — DEX-2 scope)
4. **MEV-Share / MEV Blocker** order flow auctions
5. **Real-time alerting** to operator dashboard on high MEV risk