# DEX Rollback Strategy

**Step:** `DEX-DOC-ROLLBACK`  
**Risk level:** `medium`  
**Status:** `done`

## Overview

This document describes the rollback strategy for DEX-related database migrations (032–036) and application-level features in the Arbibot 2 execution pipeline.

## Rollback Principles

1. **Forward-only preferred:** DEX migrations add tables/columns; prefer forward fixes over rollbacks
2. **Data preservation:** Rollbacks must not lose in-flight `on_chain_transactions` or `bridge_transfers`
3. **Single-writer respect:** Only `execution-orchestrator` writes to DEX tables; stop it first
4. **Idempotent migrations:** All migrations use `IF NOT EXISTS` / `IF NOT NULL` — safe to re-apply

## Migration Inventory

| Migration | Tables / Columns Added | Reversible? | Data Risk |
|-----------|----------------------|-------------|-----------|
| `032_dex_filters_seed.sql` | Seed data for `dex.filters` config key | ✅ Yes (DELETE) | None — seed only |
| `033_dex_on_chain.sql` | `on_chain_transactions`, `wallet_states`, `dex_pools`, `approvals` | ⚠️ Partial | Active TX data loss |
| `034_on_chain_tx_leg_id_uuid.sql` | `on_chain_transactions.legId` bigint→uuid | ⚠️ Complex | Data conversion |
| `035_dex_live_limits_seed.sql` | Seed data for `dex.limits` + `dex.live` config | ✅ Yes (DELETE) | None — seed only |
| `036_dex2_crosschain.sql` | `execution_legs.leg_type`, `execution_legs.chain_id`, `bridge_transfers`, `on_chain_transactions.bridge_transfer_id`, `on_chain_transactions.tx_role` | ⚠️ Partial | Active bridge TX data loss |

## Rollback Procedures

### Level 1: Seed Rollback (Low Risk)

**Applies to:** `032`, `035` (config seed data only)

```sql
-- Rollback 032: Remove DEX filters seed
DELETE FROM policy_configuration_entries
WHERE config_key = 'dex.filters'
  AND version = 1;

-- Rollback 035: Remove DEX limits/live seed
DELETE FROM policy_configuration_entries
WHERE config_key IN ('dex.limits', 'dex.live')
  AND version = 1;
```

**Re-apply:** Re-run the migration file or use `npm run db:migrate` (forward-only, won't re-insert if `schema_migrations` has the row).

### Level 2: Cross-Chain Feature Disable (Medium Risk)

**Applies to:** `036` — disable cross-chain without dropping tables

#### Step 1: Stop Cross-Chain Workers

```bash
# Stop execution-orchestrator
# On deployment: scale replicas to 0 or stop the service
```

#### Step 2: Disable Cross-Chain via Config

```bash
# Disable cross-chain via config-service (no DB changes)
curl -X PUT http://localhost:3019/policy/configurations/dex.limits \
  -H "Content-Type: application/json" \
  -d '{
    "configValue": "{\"crossChainEnabled\": false}",
    "operatorId": "operator-1",
    "approveReason": "Rollback: disabling cross-chain feature"
  }'
```

#### Step 3: Drain Active Transfers

```sql
-- Check for active bridge transfers
SELECT id, status, source_chain_id, destination_chain_id, submitted_at
FROM bridge_transfers
WHERE status IN ('pending', 'relaying', 'confirming');

-- If any exist: wait for completion or manually resolve before proceeding
```

#### Step 4: Re-enable (Forward)

To re-enable cross-chain:
```bash
curl -X PUT http://localhost:3019/policy/configurations/dex.limits \
  -H "Content-Type: application/json" \
  -d '{
    "configValue": "{\"crossChainEnabled\": true}",
    "operatorId": "operator-1",
    "approveReason": "Re-enabling cross-chain after incident resolution"
  }'
```

### Level 3: Column Rollback (High Risk)

**Applies to:** `036` columns on `execution_legs`, `on_chain_transactions`

#### Rollback 036 Columns

```sql
-- ONLY if no active bridge transfers exist
-- Verify first:
SELECT count(*) FROM bridge_transfers WHERE status IN ('pending', 'relaying', 'confirming');
-- Must be 0

-- Remove bridge_transfer_id and tx_role from on_chain_transactions
ALTER TABLE on_chain_transactions DROP COLUMN IF EXISTS bridge_transfer_id;
ALTER TABLE on_chain_transactions DROP COLUMN IF EXISTS tx_role;

-- Remove leg_type and chain_id from execution_legs
ALTER TABLE execution_legs DROP COLUMN IF EXISTS leg_type;
ALTER TABLE execution_legs DROP COLUMN IF EXISTS chain_id;

-- Drop bridge_transfers table
DROP TABLE IF EXISTS bridge_transfers;

-- Remove migration record
DELETE FROM schema_migrations WHERE version = '036';
```

⚠️ **Warning:** This destroys all bridge transfer history. Only use if cross-chain feature is being permanently removed.

### Level 4: Full DEX Rollback (Extreme)

**Applies to:** `032`–`036` complete removal

⚠️ **Only for catastrophic failure during initial DEX rollout.** Not recommended after any live trading.

```sql
-- Prerequisite: stop execution-orchestrator
-- Prerequisite: verify NO active on_chain_transactions

-- Rollback in reverse order:
-- 036
ALTER TABLE on_chain_transactions DROP COLUMN IF EXISTS bridge_transfer_id;
ALTER TABLE on_chain_transactions DROP COLUMN IF EXISTS tx_role;
ALTER TABLE execution_legs DROP COLUMN IF EXISTS leg_type;
ALTER TABLE execution_legs DROP COLUMN IF EXISTS chain_id;
DROP TABLE IF EXISTS bridge_transfers;

-- 034: legId is uuid, was bigint — cannot revert without data migration
-- Leave as uuid if data exists; only revert if table is empty
-- TRUNCATE on_chain_transactions; -- ONLY if no data to preserve
-- ALTER TABLE on_chain_transactions ALTER COLUMN leg_id TYPE BIGINT USING leg_id::bigint;

-- 033
DROP TABLE IF EXISTS approvals;
DROP TABLE IF EXISTS dex_pools;
DROP TABLE IF EXISTS wallet_states;
DROP TABLE IF EXISTS on_chain_transactions;

-- 032, 035: seed data (see Level 1)

-- Remove migration records
DELETE FROM schema_migrations WHERE version IN ('032','033','034','035','036');
```

**After full rollback:**
1. Deploy pre-DEX version of `execution-orchestrator`
2. Verify non-DEX execution plans still work
3. Run `npm run e2e:phase2-controlled-execution` to validate

## Application-Level Rollback

### DEX Feature Flags

| Config Key | Purpose | Rollback Action |
|------------|---------|-----------------|
| `dex.limits` | DEX trading limits, kill switch | Set `killSwitch: true` |
| `dex.live` | Live trading enablement | Set `enabled: false` |
| `dex.filters` | Opportunity filter thresholds | Adjust or disable filters |

### Service Deployment Rollback

```bash
# Rollback execution-orchestrator to previous version
# (deployment-specific: Docker image tag, k8s rollout undo, etc.)

# Example: k8s
kubectl rollout undo deployment/execution-orchestrator -n arbibot

# Verify health
curl -s http://localhost:3012/health | jq .
curl -s http://localhost:3012/health/dex | jq .
```

### Code-Level Kill Switch (D4-B-1-KILLSWITCH)

The `execution-orchestrator` enforces the kill switch **before every live leg broadcast**
via `DexKillSwitchService` (`apps/execution-orchestrator/src/execution/risk/dex-kill-switch.service.ts`).
In `LegsService.markSent`, before any DEX submit or bridge transfer:

```typescript
// Live = on-chain DEX (venueKey ∈ DEX_VENUE_KEYS) OR bridge leg.
// Paper legs (venueKey='paper-dex') and legacy legs are never halted.
const venueKey = extractVenueKey(plan, leg);
const isLiveLeg = isBridgeLeg || isLiveVenueKey(venueKey);
if (isLiveLeg) {
  await this.killSwitch.assertLiveNotHalted(); // throws ConflictException if halted
}
```

**Two activation sources** (highest precedence first):
1. `DEX_LIVE_KILL_SWITCH` env override — operator emergency, no config-service round-trip.
   `true`/`1` → halt; `false`/`0` → explicitly allow (overrides config); unset → defer.
2. config-service `dex.limits.killSwitch` (effective, cached 30s) — toggled via operator UI / API.

**Fail-closed:** in production, if the cache is empty and no env override is set → halt
(block live). In non-production → allow (dev convenience).

**Observability:** metric `arb_dex_live_halt_active` (1=halted, 0=running); alert
`DEXLiveHaltActive` (severity critical, see `infra/prometheus/alerts.yml`).

This is the **fastest** way to halt DEX live trading without deployment changes.
Paper trading and bridge-adjacent paper flows are structurally unaffected.

## Rollback Decision Matrix

| Situation | Recommended Level | Downtime | Data Loss |
|-----------|-------------------|----------|-----------|
| Bad DEX config | Config change | None | None |
| Bridge adapter bug | Level 2 (disable cross-chain) | Minimal | None |
| Execution logic bug | Service rollback | Brief | None |
| Migration defect (no prod data) | Level 3 or 4 | Full | Possible |
| Catastrophic DEX failure | Level 4 + service rollback | Full | Possible |

## Verification After Rollback

```bash
# 1. Service health
curl -s http://localhost:3012/health | jq .

# 2. Non-DEX execution still works
npm run e2e:phase2-controlled-execution

# 3. DEX health (if DEX not fully rolled back)
curl -s http://localhost:3012/health/dex | jq .

# 4. Metrics
curl -s http://localhost:3012/metrics | grep -E 'arb_dex_|arb_bridge_'

# 5. DB integrity
psql "$DATABASE_URL" -c "
  SELECT schemaname, tablename 
  FROM pg_tables 
  WHERE schemaname = 'public' 
  ORDER BY tablename;
"
```

## Related Documentation

- [DEX Bridge Runbook](./dex-runbook-bridge.md) — bridge transfer diagnostics
- [DEX Failed TX Runbook](./dex-runbook-failed-tx.md) — transaction failure handling
- [Cross-Chain ADR](./adr-dex2-crosschain.md) — architecture decision record
- [Config Service](./services.md) — configuration management
- [Outbox/Inbox](./outbox-inbox.md) — event delivery pattern