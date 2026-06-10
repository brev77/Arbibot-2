# DEX Runbook: Failed, Stuck & Reverted On-Chain Transactions

**Step:** `DEX-DOC-RUNBOOK-TX`  
**Risk level:** `medium`  
**Status:** `done`

## Overview

This runbook covers operational procedures for handling on-chain transaction failures in the DEX execution pipeline. It addresses three categories of transaction issues:

1. **Stuck / Pending** — transaction broadcast but not mined
2. **Reverted** — transaction mined but execution reverted on-chain
3. **Failed** — transaction could not be broadcast or was dropped

## Architecture Context

- **Single-writer:** `execution-orchestrator` owns `OnChainTransaction` entity and state transitions
- **Entity:** `on_chain_transactions` table (migration `033_dex_on_chain.sql`)
- **Status flow:** `pending` → `confirmed` | `failed` | `reverted`
- **Outbox events:** `DexTransactionSubmitted`, `DexTransactionConfirmed`, `DexTransactionFailed`

## OnChainTransaction Key Fields

| Field | Type | Description |
|-------|------|-------------|
| `txHash` | varchar(66) | Unique transaction hash |
| `chainId` | integer | EVM chain ID (42161, 8453, 56, etc.) |
| `legId` | uuid | FK to `ExecutionLeg` (nullable) |
| `status` | enum | `pending`, `confirmed`, `failed`, `reverted` |
| `nonce` | bigint | Account nonce at time of submission |
| `gasLimit` | numeric | Gas limit for the transaction |
| `gasUsed` | numeric | Actual gas consumed (null until confirmed/reverted) |
| `gasPrice` / `maxFeePerGas` | numeric | Gas pricing parameters |
| `revertReason` | text | Solidity revert reason string |
| `errorMessage` | text | Error from broadcast or RPC failure |
| `confirmations` | integer | Number of block confirmations |
| `confirmedAt` | timestamp | On-chain confirmation timestamp |

## Diagnosis

### Step 1: Identify the Transaction

```bash
# Find pending transactions older than 30 minutes
psql "$DATABASE_URL" -c "
  SELECT id, tx_hash, chain_id, leg_id, status, nonce, created_at
  FROM on_chain_transactions
  WHERE status = 'pending'
    AND created_at < NOW() - INTERVAL '30 minutes'
  ORDER BY created_at ASC;
"

# Find recently failed/reverted transactions
psql "$DATABASE_URL" -c "
  SELECT id, tx_hash, chain_id, leg_id, status, revert_reason, error_message, created_at, updated_at
  FROM on_chain_transactions
  WHERE status IN ('failed', 'reverted')
    AND updated_at > NOW() - INTERVAL '1 hour'
  ORDER BY updated_at DESC;
"
```

### Step 2: Check DEX Health

```bash
# Composite DEX health (RPC, wallet, gas, pool discovery)
curl -s http://localhost:3012/health/dex | jq .

# Prometheus metrics for DEX failures
curl -s http://localhost:3012/metrics | grep -E 'arb_dex_.*(error|fail|revert|stuck)'
```

### Step 3: Cross-Reference with Execution Plan

```bash
# Get the execution plan for the affected leg
psql "$DATABASE_URL" -c "
  SELECT ep.id AS plan_id, ep.status AS plan_status, el.id AS leg_id, el.status AS leg_status,
         oct.tx_hash, oct.status AS tx_status, oct.revert_reason
  FROM execution_legs el
  JOIN execution_plans ep ON el.plan_id = ep.id
  LEFT JOIN on_chain_transactions oct ON oct.leg_id = el.id
  WHERE oct.id = <TX_ID>;
"
```

---

## Scenario A: Stuck / Pending Transaction

### Symptoms
- `on_chain_transactions.status = 'pending'` for > 30 minutes
- Execution leg stuck in `sent` or `acknowledged` state
- Reconciliation detector flags stale pending transaction

### Common Causes
1. **Gas price too low** — transaction not competitive for block inclusion
2. **Nonce gap** — a previous transaction with lower nonce is still pending
3. **Network congestion** — chain is experiencing high traffic
4. **RPC issues** — transaction was broadcast but RPC lost track of it

### Resolution Procedures

#### A1: Verify Transaction on Block Explorer

```
# Arbitrum
https://arbiscan.io/tx/<txHash>
# Base
https://basescan.org/tx/<txHash>
# BNB Chain
https://bscscan.com/tx/<txHash>
```

- If **found on-chain** → status update missed; run reconciliation or manually update:
  ```sql
  UPDATE on_chain_transactions
  SET status = 'confirmed', gas_used = <actual_gas>, block_number = <bn>,
      confirmed_at = NOW(), confirmations = 1
  WHERE tx_hash = '<txHash>';
  ```

- If **not found** → transaction was dropped or never propagated; proceed to A2 or A3

#### A2: Speed Up (Replace-by-Fee)

For EIP-1559 chains (Arbitrum, Base):

```bash
# Check current gas conditions
curl -s -X POST <RPC_URL> -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_gasPrice","params":[],"id":1}' | jq .
```

- Submit a replacement transaction with:
  - Same nonce as the stuck transaction
  - 10–20% higher `maxFeePerGas` and `maxPriorityFeePerGas`
- The system's `WalletManagerService` must handle the replacement
- **Operator approval required** if live trading is active

#### A3: Cancel Transaction

1. Send a zero-value self-transfer with the same nonce and higher gas:
   ```sql
   -- Mark the original as failed
   UPDATE on_chain_transactions
   SET status = 'failed', error_message = 'Cancelled by operator: stuck pending'
   WHERE tx_hash = '<txHash>';
   ```
2. The `ExecutionLeg` state machine should transition to `timedOut` or `failed`
3. Reconciliation will pick up the state mismatch

#### A4: Wait and Monitor

If the chain is temporarily congested:
1. Set a monitoring window (e.g., 60 minutes)
2. Check `confirmations` count periodically
3. If still pending after the window → escalate to A2 or A3

---

## Scenario B: Reverted Transaction

### Symptoms
- `on_chain_transactions.status = 'reverted'`
- `revertReason` field populated with Solidity error
- `gasUsed` > 0 (gas was consumed but execution reverted)

### Common Revert Reasons

| Revert Reason | Cause | Resolution |
|---------------|-------|------------|
| `InsufficientOutputAmount` / `UniswapV2: K` | Slippage exceeded | Check `maxSlippageBps` in `dex.limits`; increase or reduce trade size |
| `EXPIRED` / `Transaction too old` | Deadline passed | Increase swap deadline; check clock sync |
| `TransferHelper: TRANSFER_FROM_FAILED` | Insufficient token allowance | Run `approve()` for the router; check `WalletState.approvals` |
| `INSUFFICIENT_INPUT_AMOUNT` | Input amount mismatch | Verify opportunity data; check token decimals |
| `UniswapV2Router: EXPIRED` | Swap deadline exceeded | Increase deadline parameter |
| `Pancake: LOCKED` | Reentrancy guard on PancakeSwap | Retry after short delay; possible concurrent swap |
| `ERC20: insufficient balance` | Wallet lacks tokens | Fund wallet or reduce trade size |
| `Gas estimation failed` | Pre-check predicted revert | Do not submit; investigate root cause first |

### Resolution Procedures

#### B1: Inspect Revert Reason

```sql
SELECT tx_hash, chain_id, revert_reason, gas_used, gas_limit, input_data
FROM on_chain_transactions
WHERE tx_hash = '<txHash>';
```

1. Decode `input_data` using the relevant ABI (`@arbibot/contracts-eth`)
2. Match `revertReason` to the table above
3. Determine if the issue is transient (retry) or systematic (config change needed)

#### B2: Token Allowance Issue

```bash
# Check current allowance for the token
curl -s -X POST <RPC_URL> -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0","method":"eth_call","params":[{
      "to":"<TOKEN_ADDRESS>",
      "data":"0xdd62ed3e000000000000000000000000<WALLET>000000000000000000000000<ROUTER>"
    },"latest"],"id":1
  }' | jq .
```

If allowance is insufficient:
1. Submit an `approve()` transaction via the DEX adapter
2. Wait for confirmation
3. Retry the original trade

#### B3: Slippage Exceeded

1. Check current `maxSlippageBps` in `dex.limits`:
   ```bash
   curl -s http://localhost:3019/policy/configurations/dex.limits/effective | jq '.configValue.maxSlippageBps'
   ```
2. Review market conditions — high volatility may require wider slippage
3. If increasing slippage: **two-person approval** required for live trading
4. Consider reducing `maxNotionalPerTradeUsd` instead

#### B4: Systematic Investigation

If multiple reverts with the same reason:
1. Check if the DEX pool exists and has liquidity (`DexPool` entity)
2. Verify pool discovery freshness (`GET /health/dex` → pool discovery status)
3. Check if token contract has transfer restrictions (tax tokens, honeypots)
4. Review opportunity filter thresholds (`dex.filters` config key)

---

## Scenario C: Failed Broadcast

### Symptoms
- `on_chain_transactions.status = 'failed'`
- `errorMessage` populated with RPC/network error
- No `txHash` on block explorer

### Common Error Messages

| Error Message | Cause | Resolution |
|---------------|-------|------------|
| `nonce too low` | Nonce collision or reused nonce | Fix nonce management; see C1 |
| `replacement fee too low` | Replace-by-fee with insufficient bump | Increase gas bump percentage |
| `insufficient funds for gas` | Wallet lacks native tokens for gas | Fund wallet with ETH/BNB |
| `network timeout` | RPC provider issue | Failover to backup RPC; check C2 |
| `rate limit exceeded` | RPC rate limit hit | Reduce request rate; upgrade RPC plan |
| `connection refused` | RPC endpoint down | Switch to backup RPC provider |

### Resolution Procedures

#### C1: Nonce Management Issue

```sql
-- Check recent transactions for nonce gaps
SELECT tx_hash, nonce, status, created_at
FROM on_chain_transactions
WHERE chain_id = <CHAIN_ID>
  AND from_address = '<WALLET>'
ORDER BY nonce DESC
LIMIT 20;
```

1. Identify the gap (e.g., nonce 5 confirmed, nonce 7 pending, nonce 6 missing)
2. Either submit a filler transaction at the missing nonce, or cancel nonce 7 and resubmit
3. The `WalletManagerService` tracks nonce via `wallet_states` table

#### C2: RPC Provider Failover

1. Check `DexHealthService` for RPC health:
   ```bash
   curl -s http://localhost:3012/health/dex | jq '.rpc'
   ```
2. If primary RPC is degraded:
   - Verify `RPC_PROVIDER_URLS` environment variable has multiple providers
   - The `RpcProviderManager` should auto-failover
   - If not failing over: check logs for `RpcProviderManager` errors

#### C3: Wallet Funding

```bash
# Check wallet native token balance
curl -s -X POST <RPC_URL> -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["<WALLET>","latest"],"id":1}' | jq .
```

1. If balance is below gas reserve threshold → fund wallet
2. Monitor `arb_dex_wallet_balance_native` gauge for proactive alerts
3. Set up low-balance alert in Grafana

---

## Reconciliation Integration

The DEX reconciliation system automatically detects:

1. **Stale pending transactions** — `pending` > threshold → flags incident
2. **Missing fill tracking** — `confirmed` on-chain but no `LegFilled` event → reconciliation mismatch
3. **Unexpected state** — `ExecutionLeg` status doesn't match on-chain reality

Reconciliation runs periodically and creates incidents for mismatches:

```bash
# Check for DEX reconciliation incidents
curl -s http://localhost:3020/HERMES/v1/incidents | jq '.[] | select(.type == "dex")'
```

---

## Escalation Path

| Severity | Condition | Action |
|----------|-----------|--------|
| **P3 — Low** | Single stuck tx < 30 min | Monitor; auto-resolve via reconciliation |
| **P2 — Medium** | Multiple stuck tx or revert > 3 in 1h | Investigate root cause; adjust config |
| **P1 — High** | All DEX tx failing; wallet drained | Enable kill switch; halt trading; on-call |
| **P0 — Critical** | Funds at risk; MEV attack active | Kill switch; two-person review; incident |

### P0/P1 Emergency: Kill Switch

```bash
# Immediate stop via config-service
curl -X PUT http://localhost:3019/policy/configurations/dex.limits \
  -H "Content-Type: application/json" \
  -d '{
    "configValue": "{...\"killSwitch\":true}",
    "operatorId": "operator-1",
    "approveReason": "EMERGENCY: DEX transaction failures — kill switch"
  }'
```

---

## Monitoring & Alerts

### Key Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `arb_dex_transactions_total{status="pending"}` | gauge | Currently pending transactions |
| `arb_dex_transactions_total{status="reverted"}` | counter | Total reverted transactions |
| `arb_dex_transactions_total{status="failed"}` | counter | Total failed broadcasts |
| `arb_dex_gas_price_gwei` | gauge | Current gas price per chain |
| `arb_dex_wallet_balance_native` | gauge | Native token balance per wallet |
| `arb_dex_mev_detected_total` | counter | MEV attacks detected |
| `arb_execution_leg_status_total` | gauge | Execution leg states |

### Recommended Alerts

```yaml
# Stuck transaction alert
- alert: DexStuckTransactions
  expr: arb_dex_transactions_total{status="pending"} > 5
  for: 15m
  labels:
    severity: warning
  annotations:
    summary: "DEX has {{ $value }} stuck pending transactions"

# High revert rate alert
- alert: DexHighRevertRate
  expr: rate(arb_dex_transactions_total{status="reverted"}[5m]) > 0.1
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "DEX revert rate above 10% ({{ $value }} per second)"

# Wallet low balance alert
- alert: DexWalletLowBalance
  expr: arb_dex_wallet_balance_native < 0.01
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "DEX wallet {{ $labels.wallet }} has low native balance: {{ $value }}"
```

### Grafana Dashboard

Dashboard `arbibot-dex-overview.json` includes panels for:
- Transaction status breakdown (pending/confirmed/failed/reverted)
- Gas price trends per chain
- Wallet balances
- Revert reason distribution

---

## Prevention

1. **Gas estimation buffer:** Always estimate gas with 20% buffer before submission
2. **Nonce tracking:** `WalletManagerService` maintains per-chain nonce via `wallet_states`
3. **Slippage protection:** `maxSlippageBps` in `dex.limits` caps acceptable slippage
4. **Allowance pre-check:** Verify ERC-20 allowance before swap submission
5. **RPC failover:** Multiple RPC providers configured per chain
6. **Mempool monitoring:** `DexMempoolMonitor` detects potential MEV and high gas conditions
7. **Deadlines:** All swap transactions include reasonable deadline (default: 30 minutes)

## Related Documentation

- [DEX Live Mainnet Runbook](./dex-live-mainnet-runbook.md) — live trading procedures
- [DEX Testnet Runbook](./dex-testnet-runbook.md) — testnet testing
- [DEX MEV Threats](./dex-mev-threats.md) — MEV detection and mitigation
- [Observability & Tracing](./observability-tracing.md) — SLO tiers and monitoring
- [State Machines](./state-machines.md) — ExecutionPlan/ExecutionLeg state machines
- [Key Rotation Runbook](./key-rotation-runbook.md) — wallet key rotation
- [DEX Base Runbook](./dex-base-runbook.md) — Base chain specifics
- [DEX BNB Runbook](./dex-bnb-runbook.md) — BNB Chain specifics
- [DEX Arbitrum Runbook](./dex-arbitrum-runbook.md) — Arbitrum specifics