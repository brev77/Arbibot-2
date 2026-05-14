# DEX Live Mainnet Runbook

**Step:** `DEX-1-3-LIVE-MAINNET`  
**Risk level:** `critical`  
**Status:** `done`

## Overview

This runbook covers the operational procedures for enabling and managing DEX live trading on mainnet with capital limits, risk controls, and DEX-specific gas ceilings.

## Architecture Principles

- **Reservation-first:** DEX legs never start without valid `RiskDecision` and `CapitalReservation`
- **Single-writer:** `ExecutionPlan` state machine is owned by `execution-orchestrator`
- **Idempotent commit:** fill events and operator actions are idempotent
- **Outbox/inbox:** all DEX events go through outbox pattern

## Configuration Keys

### `dex.limits` — Capital, Risk, Gas Limits

Managed via `config-service` (`GET/PUT /policy/configurations/dex.limits/effective`).

```json
{
  "enabled": false,
  "maxNotionalPerTradeUsd": 500,
  "maxDailyNotionalUsd": 5000,
  "maxOpenPositions": 3,
  "maxSlippageBps": 50,
  "chains": {
    "42161": {
      "enabled": false,
      "maxGasPriceGwei": 30,
      "maxPriorityFeeGwei": 1,
      "maxGasPerTradeGwei": 5000000,
      "maxNotionalPerTradeUsd": 500
    }
  },
  "killSwitch": false,
  "requireTwoPersonApproval": true,
  "requireOperatorApprovalPerTrade": true
}
```

| Field | Description | Default |
|-------|-------------|---------|
| `enabled` | Global DEX live trading toggle | `false` |
| `maxNotionalPerTradeUsd` | Max notional per single DEX trade | `500` |
| `maxDailyNotionalUsd` | Max total daily notional across all DEX trades | `5000` |
| `maxOpenPositions` | Max concurrent open DEX positions | `3` |
| `maxSlippageBps` | Max allowed slippage in basis points | `50` (0.5%) |
| `chains.{chainId}.enabled` | Per-chain enable toggle | `false` |
| `chains.{chainId}.maxGasPriceGwei` | Per-chain gas price ceiling | chain-specific |
| `chains.{chainId}.maxGasPerTradeGwei` | Per-chain max gas per trade | chain-specific |
| `killSwitch` | Emergency: immediately stops all DEX trading | `false` |
| `requireTwoPersonApproval` | Require two operators for config changes | `true` |
| `requireOperatorApprovalPerTrade` | Require operator approval for each live trade | `true` |

### `dex.live` — Live Mode Configuration

```json
{
  "liveEnabled": false,
  "paperParallelEnabled": true,
  "chains": ["42161"],
  "maxPositionDurationMinutes": 60,
  "autoHedgeEnabled": false,
  "autoUnwindEnabled": false,
  "dryRunMode": true,
  "auditAllTrades": true
}
```

| Field | Description | Default |
|-------|-------------|---------|
| `liveEnabled` | Master switch for live DEX trading | `false` |
| `paperParallelEnabled` | Run paper trading alongside live for drift comparison | `true` |
| `chains` | Allowed chain IDs for live trading | `["42161"]` |
| `maxPositionDurationMinutes` | Max time a DEX position can remain open | `60` |
| `autoHedgeEnabled` | Automatic hedging on adverse moves | `false` |
| `autoUnwindEnabled` | Automatic unwind on timeout | `false` |
| `dryRunMode` | If true, signs but does not broadcast transactions | `true` |
| `auditAllTrades` | Write full audit trail for every live trade | `true` |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DEX_LIVE_ENABLED` | Feature flag: enable live DEX execution adapter | `false` |
| `DEX_LIVE_KILL_SWITCH` | Emergency kill switch (immediate stop) | `false` |
| `DEX_LIVE_DRY_RUN` | Sign but do not broadcast transactions | `true` |
| `DEX_LIVE_MAX_NOTIONAL_USD` | Override max notional per trade (USD) | from config |
| `DEX_LIVE_MAX_GAS_PRICE_GWEI` | Override max gas price (GWEI) | from config |
| `DEX_LIVE_REQUIRE_APPROVAL` | Require operator approval per trade | `true` |

## Pre-Live Checklist

Before enabling live DEX trading on mainnet, verify ALL of the following:

### Infrastructure

- [ ] RPC providers are production-grade (Alchemy/Infura with dedicated key)
- [ ] RPC failover URLs configured for each chain
- [ ] Key vault encryption key is in secrets manager (not `.env`)
- [ ] Wallet has sufficient native tokens for gas (ETH on Arbitrum, etc.)
- [ ] Wallet has sufficient ERC-20 token balances for initial trades

### Configuration

- [ ] `dex.limits` configured with conservative values in config-service
- [ ] `dex.live` configured with `liveEnabled: false` initially
- [ ] Gas policy env vars set (`MAX_GAS_PRICE_GWEI`, per-chain overrides)
- [ ] `DEX_LIVE_DRY_RUN=true` for initial testing
- [ ] `DEX_LIVE_REQUIRE_APPROVAL=true` enforced

### Monitoring

- [ ] Grafana dashboard `arbibot-dex-overview.json` imported and visible
- [ ] DEX health endpoint `GET /health/dex` returning `healthy`
- [ ] Prometheus alerts configured for gas spikes, MEV detection, trade failures
- [ ] Paper-mainnet drift metrics baseline recorded

### Paper Verification

- [ ] Paper-mainnet (`DEX-1-3-PAPER-MAINNET`) completed with acceptable drift
- [ ] Drift metrics: `arb_paper_dex_drift_bps` < 50 bps sustained
- [ ] Paper profit/loss tracking verified
- [ ] Comparison metrics between paper and expected values documented

### Team & Process

- [ ] Two operators available for approval flow
- [ ] Runbook reviewed by all operators
- [ ] Emergency rollback procedure tested (config → `enabled: false`)
- [ ] On-call rotation includes DEX-aware operator

## Enabling Live Trading (Step-by-Step)

### Phase 1: Dry Run Mode

1. **Verify prerequisites** — all checklist items above confirmed
2. **Set `dex.limits` via config-service:**
   ```bash
   curl -X PUT http://localhost:3019/policy/configurations/dex.limits \
     -H "Content-Type: application/json" \
     -d '{
       "configValue": "{\"enabled\":true,\"maxNotionalPerTradeUsd\":100,\"maxDailyNotionalUsd\":500,...}",
       "operatorId": "operator-1",
       "approveReason": "DEX live dry-run phase 1"
     }'
   ```
3. **Set `DEX_LIVE_DRY_RUN=true`** in execution-orchestrator env
4. **Set `DEX_LIVE_ENABLED=true`** in execution-orchestrator env
5. **Run 3–5 dry-run trades** — verify signing, gas estimation, slippage checks
6. **Review audit logs** — all trades should appear with `dryRun: true`

### Phase 2: Minimal Live (Single Operator)

1. **Reduce `maxNotionalPerTradeUsd` to minimum** (e.g., $50–$100)
2. **Set `DEX_LIVE_DRY_RUN=false`**
3. **Verify `DEX_LIVE_REQUIRE_APPROVAL=true`**
4. **Execute first live trade** with operator approval
5. **Monitor:**
   - Gas used vs estimated
   - Actual slippage vs predicted
   - Fill tracking: `PortfolioPosition` contains `txHash`, `gasUsed`
   - Reconciliation: no mismatches detected
6. **Review metrics after 10 trades** — latency, success rate, profit/loss

### Phase 3: Gradual Scale-Up

1. **Increase `maxNotionalPerTradeUsd`** in $100 increments
2. **Monitor drift** between paper and live (`arb_paper_dex_drift_bps`)
3. **Review daily P&L** and adjust limits accordingly
4. **Consider disabling `requireOperatorApprovalPerTrade`** only after 50+ successful trades
5. **Enable additional chains** by adding to `dex.limits.chains` and `dex.live.chains`

## Emergency Procedures

### Kill Switch (Immediate Stop)

1. **Config-level kill switch:**
   ```bash
   curl -X PUT http://localhost:3019/policy/configurations/dex.limits \
     -d '{"configValue": "{...\"killSwitch\":true}", "operatorId": "operator-1", "approveReason": "EMERGENCY: kill switch activated"}'
   ```
2. **OR env-level kill switch:** set `DEX_LIVE_KILL_SWITCH=true` and restart execution-orchestrator
3. **OR disable entirely:** set `DEX_LIVE_ENABLED=false` and restart

### Gas Spike Response

1. Monitor `arb_dex_gas_price_gwei` gauge
2. If gas exceeds `maxGasPriceGwei`, transactions are automatically rejected
3. Wait for gas to normalize or increase limit (with two-person approval)

### MEV Attack Detected

1. Monitor `arb_dex_mev_detected_total` counter
2. If sustained MEV activity detected:
   - Enable `dryRunMode` in `dex.live` config
   - Review mempool monitor logs
   - Consider increasing slippage tolerance or delaying trades

### Stuck Transaction

1. Check `GET /health/dex` for pending transaction count
2. Review `on_chain_transactions` table for `status: pending`
3. If stuck > 30 minutes: consider `replace-by-fee` (if policy allows)
4. Reconciliation will flag stale pending transactions

## Verification Commands

```bash
# Check DEX limits config
curl http://localhost:3019/policy/configurations/dex.limits/effective

# Check DEX live config
curl http://localhost:3019/policy/configurations/dex.live/effective

# Check DEX health
curl http://localhost:3012/health/dex

# Check metrics
curl http://localhost:3012/metrics | grep arb_dex_

# Check paper-mainnet drift
curl http://localhost:3012/metrics | grep arb_paper_dex_drift_bps
```

## Success Metrics

| Metric | Target | Alert Threshold |
|--------|--------|----------------|
| Trade success rate | > 95% | < 90% |
| Fill tracking latency | < 1s after receipt | > 2s |
| Gas estimation accuracy | ±20% | ±50% |
| Slippage (actual vs predicted) | < 50 bps | > 100 bps |
| Paper vs live drift | < 30 bps sustained | > 50 bps |
| Daily P&L | Positive (after 50 trades) | Negative 3 days |

## Rollback Procedure

1. **Immediate:** Set `dex.limits.killSwitch = true` via config-service
2. **Gradual:** Set `dex.limits.enabled = false` via config-service
3. **Full:** Set `DEX_LIVE_ENABLED=false` env and restart execution-orchestrator
4. **Recovery:** Paper trading continues independently — no impact on paper pipeline

## Related Documentation

- [DEX Paper Mainnet Runbook](./dex-paper-mainnet-runbook.md)
- [DEX Testnet Runbook](./dex-testnet-runbook.md)
- [Observability & Tracing](./observability-tracing.md)
- [State Machines](./state-machines.md)
- [Reservation-First Protocol](./reservation-first.md)
- [DEX MEV Threats](./dex-mev-threats.md)
- [Key Rotation Runbook](./key-rotation-runbook.md)