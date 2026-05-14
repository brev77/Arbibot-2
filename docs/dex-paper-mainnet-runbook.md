# DEX Paper Mainnet Runbook

**Step:** `DEX-1-3-PAPER-MAINNET`
**Date:** 2026-05-11
**Status:** Paper trading on mainnet data stream — no real transactions

## Overview

Paper mainnet mode runs the full DEX pipeline (opportunity → risk → capital → arm → execution → fill) against **live mainnet market data**, but all execution is simulated via `PaperDexAdapter` (`venueKey: paper-dex`). No on-chain transactions are submitted.

**Purpose:**
- Validate the entire DEX arbitrage pipeline with real market data
- Measure drift between simulated and actual on-chain prices
- Accumulate operational statistics before enabling live execution
- Provide operator confidence metrics (success rate, latency, profit accuracy)

## Architecture

```
Market Data (mainnet) → Opportunity → Risk → Capital → Arm → PaperDexAdapter → Fill
         ↑                                                                  ↓
    Real prices                                                    Simulated output
         ↓                                                                  ↓
    Pool Discovery ───────────→ Drift Comparison ←────── Paper vs Expected
```

**Key principle:** Paper execution is completely isolated from live. The `PaperDexAdapter` implements `VenueAdapter` but never touches the blockchain.

## Feature Flag

```bash
# Enable paper mainnet mode (default: false)
PAPER_DEX_MAINNET_ENABLED=true

# When false, paper-dex venue is only available in testnet/paper mode
# When true, execution-orchestrator routes paper-dex legs even for mainnet opportunities
```

Additional PaperDexAdapter configuration (already available from DEX-1-3-PAPER-TESTNET):

```bash
PAPER_DEX_SIMULATED_GAS_USED=180000          # Gas per swap
PAPER_DEX_SIMULATED_GAS_PRICE_GWEI=0.1       # Gas price (Arbitrum L2)
PAPER_DEX_SIMULATED_OUTPUT_MULTIPLIER=1.0     # Output multiplier (1.0 = realistic)
PAPER_DEX_SIMULATED_PRICE_IMPACT_BPS=5        # Price impact (0.05%)
```

## Drift Metrics

Drift is the difference between the simulated paper output and the expected output based on real on-chain prices (from pool discovery or canonical market data).

### Prometheus Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `arb_paper_dex_drift_bps` | Histogram | `chain_id`, `route_key` | Drift in basis points between paper and expected |
| `arb_paper_dex_drift_samples_total` | Counter | `chain_id`, `status` | Total drift samples collected |
| `arb_paper_dex_swap_total` | Counter | `chain_id`, `status` | Paper swap operations (existing) |
| `arb_paper_dex_swap_latency_seconds` | Histogram | `chain_id` | Paper swap latency (existing) |
| `arb_paper_dex_simulated_gas_cost_eth` | Gauge | `chain_id` | Simulated gas cost (existing) |
| `arb_paper_dex_simulated_profit_usd` | Gauge | `chain_id`, `venue` | Simulated profit (existing) |

### SLO Targets

| Metric | Target | Window |
|--------|--------|--------|
| Drift median | < 10 bps | 5m rolling |
| Drift P95 | < 50 bps | 15m rolling |
| Drift P99 | < 100 bps | 1h rolling |
| Paper success rate | > 99.5% | 1h |
| Paper latency P99 | < 50ms | 5m |

### Grafana Panel

Drift panel added to `infra/grafana/dashboards/arbibot-dex-paper-mainnet.json`:
- **Row 1:** Paper swap rate, success rate, latency
- **Row 2:** Drift histogram (median, P95, P99 over time)
- **Row 3:** Simulated profit/loss, gas cost trends
- **Row 4:** Drift by route_key (top 10 routes)

### Alerts

```yaml
# Paper drift sustained high
- alert: PaperDexDriftSustainedHigh
  expr: histogram_quantile(0.95, rate(arb_paper_dex_drift_bps_bucket[15m])) > 50
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Paper DEX drift P95 > 50 bps for 5m"

# Paper success rate drop
- alert: PaperDexSuccessRateDrop
  expr: |
    rate(arb_paper_dex_swap_total{status="success"}[5m])
    / rate(arb_paper_dex_swap_total[5m]) < 0.995
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "Paper DEX success rate < 99.5%"
```

## Operator Checklist: Paper → Live Transition

Before transitioning from paper mainnet to live mainnet (`DEX-1-3-LIVE-MAINNET`), verify:

### Pre-conditions (all must be ✅)

- [ ] **Paper running for ≥ 72 hours** continuously without crashes
- [ ] **Paper success rate > 99.5%** over the last 24 hours
- [ ] **Drift median < 10 bps, P95 < 50 bps** over the last 24 hours
- [ ] **No reconciliation mismatches** between paper state and expected state
- [ ] **All DEX adapters validated** on testnet (DEX-1-3-LIVE-TESTNET passed)
- [ ] **Gas estimates accurate** — simulated gas within 20% of on-chain gas for testnet runs
- [ ] **Slippage protection validated** — no simulated swap would have reverted on-chain
- [ ] **Operator approval workflow tested** — two-step approval for live enablement
- [ ] **Rollback plan documented** — how to disable live and return to paper
- [ ] **Capital limits configured** — maximum notional per plan, per day, total exposure

### Metrics Review

```bash
# Check paper success rate (last 24h)
curl -s http://localhost:3012/metrics | grep arb_paper_dex_swap_total

# Check drift distribution (last 24h)
curl -s http://localhost:3012/metrics | grep arb_paper_dex_drift_bps

# Check simulated profit/loss
curl -s http://localhost:3012/metrics | grep arb_paper_dex_simulated_profit_usd
```

### Transition Steps

1. **Operator review:** Analyze paper metrics dashboard, confirm all SLOs met
2. **Impact preview:** Run live preview with minimum capital ($10 notional)
3. **Operator approval:** Two-step approval in `/execution` UI
4. **Enable live:** Set `DEX_VENUE_ENABLED=true`, reduce `PAPER_DEX_MAINNET_ENABLED` scope
5. **Monitor:** Watch live metrics for 1 hour, compare with paper baseline
6. **Gradual ramp:** Increase capital limits by 2x every 24h until target reached

### Emergency Rollback

If live execution shows issues:
1. Set `DEX_VENUE_ENABLED=false` immediately
2. All new plans will fall back to paper or reject
3. In-flight legs will complete (cannot cancel on-chain)
4. Review reconciliation mismatches
5. Return to paper mainnet mode for analysis

## Configuration via Config Service

Paper mainnet settings can be managed via config-service:

```bash
# Paper mainnet config key
GET /policy/configurations/paper.dex.mainnet/effective

# Example payload:
{
  "configKey": "paper.dex.mainnet",
  "value": {
    "enabled": true,
    "driftThresholdBps": 50,
    "minSampleCount": 100,
    "autoDisableOnHighDrift": true,
    "maxConcurrentPaperPlans": 5
  }
}
```

## Related Documentation

- [DEX Testnet Runbook](./dex-testnet-runbook.md) — testnet live execution
- [DEX Load Test Report](./dex-load-test-report.md) — load testing results
- [Observability & Tracing](./observability-tracing.md) — DEX SLO targets
- [Paper Promotion Quality Criteria](./paper-promotion-quality-criteria.md) — paper → live promotion