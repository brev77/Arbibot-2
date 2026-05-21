# DEX Runbook: Cross-Chain Bridge Transfers

**Step:** `DEX-DOC-RUNBOOK-BRIDGE`  
**Risk level:** `medium`  
**Status:** `done`

## Overview

This runbook covers operational procedures for managing cross-chain bridge transfers in the DEX execution pipeline. It addresses:

1. **Stuck / Pending** — bridge transfer submitted but not relayed
2. **Timed Out** — transfer exceeded the estimated relay window
3. **Failed** — bridge rejected the transfer or on-chain error
4. **Mismatch** — completed transfer with missing or inconsistent data

## Architecture Context

- **Single-writer:** `execution-orchestrator` owns `BridgeTransfer` entity and state transitions
- **Entity:** `bridge_transfers` table (migration `036_dex2_crosschain.sql`)
- **State machine:** `pending` → `relaying` → `confirming` → `completed` | `failed` | `timed_out`
- **Reconciliation:** `CrossChainReconciliationService` + `CrossChainReconWorker`
- **Polling:** `BridgeTransferPollingWorker` polls active transfers via adapter

## Bridge Adapters

| Bridge Key | Protocol | Use Case | Chains |
|------------|----------|----------|--------|
| `across` | Across Protocol | L2→L1, L2→L2 | Arbitrum, Base |
| `stargate` | Stargate (LayerZero) | Cross-chain bridges | Arbitrum, Base, BNB |
| `native` | Official L2 bridges | Canonical L2 bridges | Arbitrum, Base |

Adapter resolution: `BridgeAdapterFactoryService.resolve(bridgeKey)`

## BridgeTransfer Key Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `legId` | UUID | FK to `execution_legs` |
| `bridgeKey` | TEXT | Adapter key: `across` \| `stargate` \| `native` |
| `sourceChainId` | INTEGER | Source EVM chain ID |
| `destinationChainId` | INTEGER | Destination EVM chain ID |
| `sourceTxHash` | VARCHAR(66) | Source chain transaction hash |
| `destinationTxHash` | VARCHAR(66) | Destination chain transaction hash |
| `bridgeId` | TEXT | Protocol-specific bridge identifier |
| `tokenAddress` | VARCHAR(42) | Source token contract |
| `destinationTokenAddress` | VARCHAR(42) | Destination token contract |
| `amount` | NUMERIC(78,0) | Token amount in wei |
| `status` | TEXT | `pending` \| `relaying` \| `confirming` \| `completed` \| `failed` \| `timed_out` |
| `estimatedRelayMs` | BIGINT | Estimated relay time from adapter |
| `actualRelayMs` | BIGINT | Actual relay time (filled on completion) |
| `idempotencyKey` | TEXT | Deterministic key (`planId:legIndex:bridgeKey`) |
| `submittedAt` | TIMESTAMPTZ | Submission timestamp |
| `confirmedAt` | TIMESTAMPTZ | Completion timestamp |
| `failedAt` | TIMESTAMPTZ | Failure timestamp |
| `timeoutAt` | TIMESTAMPTZ | Deadline (2× estimated relay) |
| `errorMessage` | TEXT | Error description |

## Diagnosis

### Step 1: Identify Active / Problem Transfers

```bash
# Find all active (non-terminal) bridge transfers
psql "$DATABASE_URL" -c "
  SELECT id, bridge_key, source_chain_id, destination_chain_id,
         status, source_tx_hash, destination_tx_hash,
         submitted_at, timeout_at, estimated_relay_ms,
         EXTRACT(EPOCH FROM (NOW() - submitted_at)) * 1000 AS age_ms
  FROM bridge_transfers
  WHERE status IN ('pending', 'relaying', 'confirming')
  ORDER BY submitted_at ASC;
"

# Find recently failed/timed_out transfers
psql "$DATABASE_URL" -c "
  SELECT id, bridge_key, status, error_message, failed_at, source_tx_hash
  FROM bridge_transfers
  WHERE status IN ('failed', 'timed_out')
    AND updated_at > NOW() - INTERVAL '1 hour'
  ORDER BY failed_at DESC;
"

# Find completed transfers without destination tx hash (mismatch)
psql "$DATABASE_URL" -c "
  SELECT id, bridge_key, status, source_tx_hash, destination_tx_hash, confirmed_at
  FROM bridge_transfers
  WHERE status = 'completed'
    AND destination_tx_hash IS NULL;
"
```

### Step 2: Check Cross-Chain Reconciliation Status

```bash
# Reconciliation is exposed via execution-orchestrator metrics
curl -s http://localhost:3012/metrics | grep -E 'arb_bridge_recon_(checks|mismatches|stale)_total'
```

### Step 3: Cross-Reference with Execution Plan

```bash
# Get the full execution plan context for a bridge transfer
psql "$DATABASE_URL" -c "
  SELECT ep.id AS plan_id, ep.state AS plan_state,
         el.id AS leg_id, el.leg_index, el.leg_type, el.state AS leg_state,
         bt.id AS transfer_id, bt.bridge_key, bt.status AS transfer_status,
         bt.source_chain_id, bt.destination_chain_id,
         bt.source_tx_hash, bt.destination_tx_hash
  FROM bridge_transfers bt
  JOIN execution_legs el ON bt.leg_id = el.id
  JOIN execution_plans ep ON el.plan_id = ep.id
  WHERE bt.id = '<TRANSFER_ID>';
"
```

---

## Scenario A: Stuck / Pending Transfer

### Symptoms
- `bridge_transfers.status = 'pending'` for > estimated relay time
- `BridgeTransferPollingWorker` logs no status change
- Cross-chain reconciliation flags as stale

### Common Causes
1. **Source chain congestion** — source TX not confirmed yet
2. **Bridge relayer backlog** — bridge operator has queue
3. **Incorrect bridge parameters** — amount/token/address mismatch
4. **Bridge protocol downtime** — temporary maintenance

### Resolution Procedures

#### A1: Verify Source Transaction

```
# Check source TX on block explorer
# Arbitrum
https://arbiscan.io/tx/<sourceTxHash>
# Base
https://basescan.org/tx/<sourceTxHash>
# BNB Chain
https://bscscan.com/tx/<sourceTxHash>
```

- If **source TX not confirmed** → follow [Failed TX Runbook](./dex-runbook-failed-tx.md) for source chain
- If **source TX confirmed** → check bridge protocol status (A2)

#### A2: Check Bridge Protocol Status

| Bridge | Status Page |
|--------|-------------|
| Across | https://app.across.to/ — check relay queue |
| Stargate | https://stargate.finance/ — bridge status |
| Native L2 | Chain-specific bridge portal |

#### A3: Wait and Monitor

Default timeout is 2× `estimatedRelayMs`. If still within timeout:
1. Monitor `BridgeTransferPollingWorker` logs
2. Check `age_ms` vs `timeout_at` from diagnosis query
3. If approaching timeout → prepare for Scenario B

#### A4: Force Manual Check

```bash
# Trigger a reconciliation cycle (if API exposed)
# The polling worker checks periodically; you can also query the adapter directly
curl -s http://localhost:3012/health/dex | jq '.bridge'
```

---

## Scenario B: Timed Out Transfer

### Symptoms
- `bridge_transfers.status = 'timed_out'`
- `failedAt` populated
- Cross-chain reconciliation incident generated

### Common Causes
1. Bridge relayer failed to process
2. Destination chain congestion
3. Bridge liquidity insufficient at time of relay
4. Incorrect destination address or token

### Resolution Procedures

#### B1: Verify On-Chain State

```bash
# Check if bridge actually completed despite timeout
# (status update may have been missed)
psql "$DATABASE_URL" -c "
  SELECT id, source_tx_hash, bridge_id, bridge_key,
         source_chain_id, destination_chain_id
  FROM bridge_transfers
  WHERE id = '<TRANSFER_ID>';
"
```

Look up `source_tx_hash` and `bridge_id` on the bridge protocol's explorer:
- Across: https://app.across.to/bridge/{sourceTxHash}
- Stargate: https://layerzeroscan.com/tx/{sourceTxHash}

If **bridge completed on-chain** but system shows `timed_out`:
```sql
-- Correct the status
UPDATE bridge_transfers
SET status = 'completed',
    destination_tx_hash = '<actual_dest_tx>',
    confirmed_at = NOW(),
    actual_relay_ms = EXTRACT(EPOCH FROM (NOW() - submitted_at)) * 1000,
    updated_at = NOW()
WHERE id = '<TRANSFER_ID>';
```

#### B2: Retry (Operator Approval Required)

Terminal state transfers (`failed`, `timed_out`) require operator approval for retry:

1. Verify the source tokens are still held by the bridge or returned
2. If tokens returned to source wallet → new bridge transfer needed
3. If tokens in transit → contact bridge protocol support
4. **Operator must approve retry** via the approval flow

#### B3: Force Unwind

If capital is at risk and bridge is unresponsive:

1. Follow force unwind procedure from [Execution Runbook](./dex-runbook-failed-tx.md)
2. **Two-person approval required** for any force unwind
3. Impact preview must be generated before execution
4. Full audit trail entry required

---

## Scenario C: Failed Transfer

### Symptoms
- `bridge_transfers.status = 'failed'`
- `errorMessage` populated
- No destination TX

### Common Error Messages

| Error Message | Cause | Resolution |
|---------------|-------|------------|
| `Insufficient liquidity` | Bridge pool lacks liquidity | Wait for refill; try different bridge |
| `Amount too low` | Below bridge minimum | Adjust trade size or use different bridge |
| `Invalid destination chain` | Unsupported chain pair | Check adapter chain support matrix |
| `Slippage exceeded` | Price moved during relay | Increase slippage tolerance; retry |
| `Token not supported` | Token not whitelisted on bridge | Use different token or bridge |
| `Source TX reverted` | Source chain TX failed | Follow [Failed TX Runbook](./dex-runbook-failed-tx.md) |

### Resolution Procedures

#### C1: Investigate Error

```sql
SELECT id, bridge_key, error_message, source_tx_hash, amount, token_address
FROM bridge_transfers
WHERE id = '<TRANSFER_ID>';
```

Match `errorMessage` to the table above for resolution.

#### C2: Switch Bridge Adapter

If one bridge adapter fails:
1. The `MultiLegPlanBuilder` selects bridge during plan construction
2. For retry: create a new plan with a different `bridgeKey`
3. Verify the new bridge supports the same chain pair and token

#### C3: Escalate to Bridge Protocol

For protocol-level failures:
1. Open issue on bridge protocol's GitHub / Discord
2. Provide `source_tx_hash`, `bridge_id`, source/destination chain IDs
3. Monitor bridge protocol status page for resolution

---

## Scenario D: Data Mismatch

### Symptoms
- `CrossChainReconciliationService` reports mismatch
- Completed transfer missing `destinationTxHash`
- Amount discrepancy between source and destination

### Mismatch Types

| Type | Description | Severity |
|------|-------------|----------|
| `missing_destination_tx` | Completed transfer without dest TX hash | Critical |
| `amount_discrepancy` | Source amount ≠ destination amount (beyond fees) | Critical |
| `missing_confirmed_at` | Completed transfer without confirmation timestamp | Warning |

### Resolution Procedures

#### D1: Verify On-Chain Completion

Look up the bridge transfer on both chains:
1. Source chain: verify `sourceTxHash` is confirmed
2. Destination chain: search for incoming transfer at `destinationTokenAddress`
3. Bridge explorer: verify relay completed

#### D2: Update Missing Data

If bridge completed but data is missing:
```sql
-- Supply missing destination TX hash
UPDATE bridge_transfers
SET destination_tx_hash = '<dest_tx_hash>',
    confirmed_at = NOW(),
    updated_at = NOW()
WHERE id = '<TRANSFER_ID>';
```

#### D3: Investigate Amount Discrepancy

1. Bridge fees are expected — check fee structure for the bridge
2. If discrepancy exceeds fee + slippage → escalate
3. Compare `amount` (source) vs actual received amount on destination chain

---

## Cross-Chain Reconciliation

### Automated Checks

`CrossChainReconWorker` runs periodic reconciliation cycles:

1. **Mismatch detection:** completed transfers with missing data
2. **Stale detection:** active transfers exceeding 30-minute threshold
3. **Plan reconciliation:** full multi-leg plan state verification

### Manual Reconciliation

```bash
# Check reconciliation metrics
curl -s http://localhost:3012/metrics | grep 'arb_bridge_recon'
```

Key metrics:
| Metric | Type | Description |
|--------|------|-------------|
| `arb_bridge_recon_checks_total` | Counter | Reconciliation cycles completed |
| `arb_bridge_recon_mismatches_total` | Counter | Mismatches detected |
| `arb_bridge_recon_stale_total` | Counter | Stale transfers detected |

### Incident Generation

The reconciliation service generates incident descriptors for operator review:

- **`bridge_transfer_stale`** — severity: `warning` (within 2× threshold) or `critical` (beyond 2×)
- **`bridge_transfer_mismatch`** — severity: always `critical`

---

## Escalation Path

| Severity | Condition | Action |
|----------|-----------|--------|
| **P3 — Low** | Single stuck transfer < 15 min | Monitor; polling worker handles |
| **P2 — Medium** | Multiple stuck transfers or 1 timeout | Investigate root cause; manual check |
| **P1 — High** | All bridge transfers failing; bridge protocol down | Halt cross-chain plans; switch to single-chain |
| **P0 — Critical** | Funds lost in bridge; no recovery path | Kill switch; two-person review; bridge protocol contact |

### P0/P1 Emergency: Kill Switch

```bash
# Disable cross-chain execution via config-service
curl -X PUT http://localhost:3019/policy/configurations/dex.limits \
  -H "Content-Type: application/json" \
  -d '{
    "configValue": "{...\"crossChainEnabled\":false}",
    "operatorId": "operator-1",
    "approveReason": "EMERGENCY: Bridge transfer failures — disabling cross-chain"
  }'
```

---

## Monitoring & Alerts

### Key Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `arb_bridge_recon_checks_total` | Counter | Total reconciliation cycles |
| `arb_bridge_recon_mismatches_total` | Counter | Mismatches detected |
| `arb_bridge_recon_stale_total` | Counter | Stale transfers detected |

### Recommended Alerts

```yaml
# Stale bridge transfer alert
- alert: BridgeStaleTransfers
  expr: arb_bridge_recon_stale_total > 0
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "Cross-chain reconciliation detected stale bridge transfers"

# Bridge mismatch alert
- alert: BridgeMismatch
  expr: arb_bridge_recon_mismatches_total > 0
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "Cross-chain reconciliation detected bridge transfer mismatches"
```

---

## Bridge-Specific Notes

### Across Protocol
- Typical relay time: 1–5 minutes for L2→L1, 1–3 minutes for L2→L2
- Uses optimistic verification — relayer submits and waits for challenge period
- `bridgeId` = Across deposit ID

### Stargate (LayerZero)
- Typical relay time: 5–15 minutes depending on verification
- Supports multiple chains via LayerZero messaging
- `bridgeId` = LayerZero GUID

### Native L2 Bridges
- Official bridges (e.g., Arbitrum Bridge, Base Bridge)
- Typical relay time: 10–60 minutes (L2→L1 requires challenge period)
- `bridgeId` = bridge-specific withdrawal/claim ID
- **L2→L1 withdrawals may take up to 7 days** for finality

---

## Prevention

1. **Idempotent submission:** `BridgeTransferService` enforces `idempotencyKey` uniqueness
2. **Timeout detection:** `BridgeTransferPollingWorker` detects transfers exceeding `timeoutAt`
3. **Adapter health check:** `GET /health/dex` includes bridge adapter availability
4. **Automatic polling:** `BridgeTransferPollingWorker` polls active transfers on configurable interval
5. **Reconciliation:** `CrossChainReconWorker` runs periodic full-cycle checks
6. **Terminal state protection:** Failed/timed_out transfers require operator approval for retry

## Related Documentation

- [DEX Failed TX Runbook](./dex-runbook-failed-tx.md) — on-chain transaction failures
- [DEX Live Mainnet Runbook](./dex-live-mainnet-runbook.md) — live trading procedures
- [DEX MEV Threats](./dex-mev-threats.md) — MEV detection and mitigation
- [Cross-Chain ADR](./adr-dex2-crosschain.md) — architecture decision record
- [Observability & Tracing](./observability-tracing.md) — SLO tiers and monitoring
- [State Machines](./state-machines.md) — ExecutionPlan/ExecutionLeg state machines
- [Key Rotation Runbook](./key-rotation-runbook.md) — wallet key rotation