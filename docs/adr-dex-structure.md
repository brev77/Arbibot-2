# ADR: DEX component architecture — placement, DI, and single-writer boundaries

**Status:** proposed — pending Architecture Guard review  
**Date:** 2026-04-28

## Context

Arbibot 2 Phase 0–5 foundation includes execution orchestrator with `VenueAdapter` pattern for HTTP venues. Phase DEX-1 requires on-chain DEX execution (Uniswap V2/V3, SushiSwap) with self-custody EOA wallets, key vault, and RPC providers. The system must respect **single-writer principle** for core entities and integrate seamlessly with existing reservation-first protocol.

## Decision (target architecture)

### 1. Placement: DEX components as module within `execution-orchestrator`

**Decision:** All DEX-specific components reside in `apps/execution-orchestrator/src/execution/dex/` as a dedicated module, not a separate service.

**Rationale:**
- `execution-orchestrator` is already the single-writer for `ExecutionPlan` and `ExecutionLeg` entities
- DEX adapters are logically bound to execution flow (arm → execute → fill)
- Avoids cross-service RPC calls and additional latency
- Maintains transactional consistency within execution module

**Module structure:**
```
apps/execution-orchestrator/src/execution/dex/
├── adapters/                    # DEX venue adapters
│   ├── uniswap-v2.adapter.ts
│   ├── uniswap-v3.adapter.ts
│   └── sushiswap.adapter.ts
├── services/                    # DEX-specific services
│   ├── rpc-provider-manager.service.ts
│   ├── dex-approve.service.ts
│   ├── dex-slippage-protection.service.ts
│   ├── gas-estimator.service.ts
│   ├── wallet-manager.service.ts
│   └── dex-fill-tracker.service.ts
├── workers/                     # Background workers
│   ├── dex-pool-discovery.worker.ts
│   └── dex-mempool-monitor.worker.ts (optional)
└── dto/                         # DEX DTOs
    ├── dex-swap-params.dto.ts
    └── dex-gas-estimate.dto.ts
```

### 2. Dependency Injection (DI) structure

**DI tokens:**
- `RPC_PROVIDER_MANAGER` — singleton `RpcProviderManager`
- `KEY_VAULT_SERVICE` — singleton `KeyVaultService` (from `@arbibot/nest-platform`)
- `WALLET_MANAGER_SERVICE` — singleton `WalletManagerService`
- `VENUE_ADAPTER_FACTORY` — factory for selecting adapter by `venue_key`
- `DEX_ADAPTERS` — multi-provider of all DEX adapters

**DI flow:**
1. `ExecutionModule` imports `DexModule`
2. `DexModule` registers all DEX services as providers
3. `VenueFactoryService` injects `DEX_ADAPTERS` and `VENUE_ADAPTER_FACTORY` token
4. Each adapter injects `RPC_PROVIDER_MANAGER`, `KEY_VAULT_SERVICE`, `WALLET_MANAGER_SERVICE`

### 3. Single-writer boundaries

**Entity ownership (strict):**

| Entity | Writer | Notes |
|--------|--------|-------|
| `ExecutionPlan` | `execution-orchestrator` | Existing single-writer |
| `ExecutionLeg` | `execution-orchestrator` | Existing single-writer |
| `on_chain_transactions` | `execution-orchestrator` | **New DEX table** |
| `wallet_states` | `execution-orchestrator` | **New DEX table** |
| `dex_pools` | `execution-orchestrator` | **New DEX table** |
| `approvals` | `execution-orchestrator` | **New DEX table** |
| `CapitalReservation` | `capital-service` | Unchanged |
| `PortfolioPosition` | `portfolio-service` | Unchanged |
| `ReconciliationMismatch` | `reconciliation-service` | Unchanged |

**Read-only cross-service boundaries:**
- `execution-orchestrator` reads `risk_decisions` (read via HTTP API, not DB)
- `execution-orchestrator` reads `capital_reservations` (read via HTTP API, not DB)
- `reconciliation-service` reads `on_chain_transactions` (read via HTTP API, not DB)

**No shared state:** DEX adapters do not write directly to `CapitalReservation`, `PortfolioPosition`, or `ReconciliationMismatch`. All writes go through existing HTTP APIs (`POST /capital/reservations`, `POST /positions/confirm-fill`, `POST /mismatches/run-detectors`).

### 4. Venue adapter interface extension

**Existing `VenueAdapter` interface** (minimal):
```typescript
interface VenueAdapter {
  submitLeg(leg: ExecutionLeg, context: ExecutionContext): Promise<VenueSubmitResult>;
}
```

**DEX extension** (via composition, not breaking change):
```typescript
interface DexVenueAdapter extends VenueAdapter {
  // DEX-specific methods (internal to execution-orchestrator)
  estimateGas(params: DexSwapParams): Promise<GasEstimate>;
  checkAllowance(wallet: string, token: string, spender: string): Promise<bigint>;
  approveToken(wallet: string, token: string, spender: string, amount: bigint): Promise<string>;
  constructSwapCalldata(params: DexSwapParams): Promise<string>;
}
```

**Rationale:** DEX adapters implement additional methods for gas estimation, approve checks, and calldata construction, but the public `submitLeg` interface remains consistent with HTTP venues.

## Alternatives considered

| Option | Rejection reason |
|--------|------------------|
| Separate `dex-execution-service` | Breaks single-writer for `ExecutionPlan`/`Leg`; adds cross-service latency |
| DEX adapters write directly to `CapitalReservation` | Violates single-writer principle; bypasses reservation-first protocol |
| Direct DB reads from other services to `on_chain_transactions` | Breaks encapsulation; couples schema to other services |
| Shared DEX state across multiple services | Creates hidden cross-service shared state; violates architecture invariants |
| DEX components in separate package (not service) | Adds unnecessary abstraction layer; DEX logic is execution-specific |

## Consequences

### Positive
- **Single-writer compliance:** All DEX entities owned by `execution-orchestrator`
- **Reservation-first:** DEX legs only execute after capital reservation via existing protocol
- **Transactional consistency:** On-chain transaction tracking in same service as execution plans
- **Observability:** Unified metrics and tracing within execution module
- **Testability:** Mock adapters can replace real DEX adapters in tests

### Negative
- **Execution orchestrator complexity:** Additional DEX module increases service footprint
- **Deployment coupling:** DEX changes require deploying execution-orchestrator (no separate DEX service)
- **Resource contention:** Background workers (pool discovery, mempool monitor) share resources with execution flow

### Mitigations
- **Module isolation:** DEX module is self-contained with clear boundaries
- **Feature flags:** `DEX_VENUE_ENABLED` allows disabling DEX without HTTP venue impact
- **Resource quotas:** Separate thread pools for DEX workers to avoid blocking execution
- **Circuit breakers:** Health checks on RPC providers prevent cascading failures

## Implementation notes

### Code references (to be implemented)
- **Module:** `apps/execution-orchestrator/src/execution/dex/dex.module.ts`
- **Factory:** `apps/execution-orchestrator/src/execution/venue/venue-factory.service.ts`
- **RPC Manager:** `apps/execution-orchestrator/src/execution/dex/services/rpc-provider-manager.service.ts`
- **Key Vault:** `packages/nest-platform/src/vault/key-vault.service.ts`
- **Wallet Manager:** `apps/execution-orchestrator/src/execution/dex/services/wallet-manager.service.ts`
- **Uniswap V2:** `apps/execution-orchestrator/src/execution/dex/adapters/uniswap-v2.adapter.ts`

### Database migrations
- **`032_dex_on_chain.sql`** — tables: `on_chain_transactions`, `wallet_states`, `dex_pools`, `approvals`
- Entities in `packages/persistence/src/entities/` for TypeORM integration

### Env vars
- `RPC_*_URL`, `RPC_*_BACKUP_URL` — RPC provider URLs
- `PRIVATE_KEY_ENCRYPTION_KEY` — Vault encryption key
- `DEX_VENUE_ENABLED` — Feature flag for DEX adapters
- `MAX_GAS_PRICE_GWEI` — Gas policy

### Observability
- Metrics prefix: `arb_dex_*` (latency, gas price, swap success rate)
- Health endpoint: `GET /health/dex` — RPC, vault, wallets status
- Grafana dashboard: `infra/grafana/dashboards/arbibot-dex-overview.json` (to be created)

## Links

- [DEVELOPMENT_PLAN-DEX.md](../.cursor/plans/DEVELOPMENT_PLAN-DEX.md) — Full DEX development plan
- [DEVELOPMENT_PLAN.md](../.cursor/plans/DEVELOPMENT_PLAN.md) — Main development plan (Phase 0-5)
- [docs/architecture-invariants.md](architecture-invariants.md) — Single-writer and other invariants
- [docs/reservation-first.md](reservation-first.md) — Reservation-first protocol