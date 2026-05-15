# DEX Frontend UI Specification

**Step:** `DEX-DOC-FE`  
**Risk level:** `low`  
**Status:** `done`

## Overview

This document specifies the frontend UI additions needed to surface DEX (decentralized exchange) execution data in the operator dashboard. It covers new fields, components, and interactions required for operators to monitor and manage on-chain DEX trades.

## Target Routes

| Route | Component | DEX Additions |
|-------|-----------|---------------|
| `/execution` | Execution Plans Workspace | DEX metadata on plans & legs |
| `/execution/:id` | Plan Detail (new) | On-chain tx details, gas, explorer links |
| `/dashboard` | Dashboard Summary | DEX health widget, aggregate stats |
| `/settings` | Settings Workspace | DEX limits config, filters |

## 1. Execution Plans Table — DEX Enhancements

### Current State

`ExecutionPlansTable` displays plans from `GET /execution/plans` using `ExecutionPlanListItem`:

```typescript
type ExecutionPlanListItem = {
  readonly id: string;
  readonly state: string;
  readonly correlationId: string | null;
  readonly capitalReservationId: string | null;
  readonly riskDecisionId: string | null;
  readonly entityVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};
```

### New Fields Required

Extend the API response and frontend type:

```typescript
type ExecutionPlanListItem = {
  // ... existing fields ...
  readonly venueType: 'http' | 'dex' | null;       // NEW: execution venue type
  readonly chainId: number | null;                  // NEW: EVM chain (42161, 8453, 56)
  readonly dexAdapter: string | null;               // NEW: adapter name (uniV2, uniV3, sushi, pancakeV2, biswapV2)
  readonly txHash: string | null;                   // NEW: primary on-chain tx hash (first leg)
  readonly txStatus: 'pending' | 'confirmed' | 'failed' | 'reverted' | null; // NEW
  readonly gasUsedWei: string | null;               // NEW: total gas consumed (wei)
  readonly gasCostUsd: string | null;               // NEW: estimated gas cost in USD
};
```

### New Table Columns

| Column | Field | Type | Width | Notes |
|--------|-------|------|-------|-------|
| **Venue** | `venueType` | badge | 80px | `dex` → purple badge with chain icon; `http` → gray badge |
| **Chain** | `chainId` | icon + label | 80px | Chain icon (Arbitrum/Base/BNB) + name |
| **Adapter** | `dexAdapter` | text | 100px | DEX name (PancakeSwap, Uniswap, etc.) |
| **Tx Hash** | `txHash` | link | 120px | Truncated `0x1234...5678` → block explorer |
| **Tx Status** | `txStatus` | badge | 90px | `pending` → yellow, `confirmed` → green, `failed` → red, `reverted` → orange |
| **Gas** | `gasCostUsd` | text | 80px | Formatted USD (`$0.42`) |

### Column Visibility

- **Default visible:** ID, State, Venue, Chain, Tx Status, Created
- **Hidden (expandable):** Correlation ID, Adapter, Tx Hash, Gas, Risk Decision, Capital Reservation
- Use TanStack Table column visibility API

### Row Interaction

- Click row → navigate to `/execution/:id` detail view
- DEX plans show chain-specific background accent (subtle)

## 2. Execution Plan Detail View (New Page)

### Route: `/execution/:id`

A dedicated page showing full plan details including legs and on-chain transaction data.

### Data Sources

```
GET /execution/plans/:id          → plan with legs
GET /execution/plans/:id/legs/:legId/on-chain-txs  → on-chain transaction details (NEW BFF)
```

### Sections

#### 2.1 Plan Header

| Field | Display |
|-------|---------|
| Plan ID | Monospace, copyable |
| State | Color-coded badge with state machine breadcrumb |
| Venue Type | `DEX` or `HTTP` badge |
| Chain | Icon + chain name + chain ID |
| DEX Adapter | Adapter name + version |
| Correlation ID | Monospace, copyable |
| Risk Decision ID | Link to risk decision (if available) |
| Capital Reservation ID | Link to capital reservation (if available) |
| Created / Updated | Relative timestamp + absolute on hover |

#### 2.2 Execution Legs Table

Each leg of the execution plan displayed as a row:

| Column | Field | Type | Notes |
|--------|-------|------|-------|
| Leg # | index | number | Sequential |
| Status | `status` | badge | Leg state machine status |
| Venue | `venueType` | badge | DEX or HTTP |
| Direction | `direction` | text | buy/sell |
| Token In | `tokenIn` | text | Token symbol + address (truncated) |
| Token Out | `tokenOut` | text | Token symbol + address (truncated) |
| Amount In | `amountIn` | number | Formatted with decimals |
| Amount Out | `amountOut` | number | Formatted with decimals |
| Tx Hash | `txHash` | link | → block explorer |
| Tx Status | `txStatus` | badge | pending/confirmed/failed/reverted |
| Gas Used | `gasUsed` | text | Gas units + USD cost |
| Gas Price | `gasPrice` | text | Gwei formatted |
| Nonce | `nonce` | number | On-chain nonce |
| Block | `blockNumber` | link | → block explorer |
| Confirmations | `confirmations` | number | With ✓ icon when sufficient |

#### 2.3 On-Chain Transaction Detail Card (Per Leg)

Expanded view when clicking a leg row:

```
┌─────────────────────────────────────────────────────┐
│ On-Chain Transaction                                │
├─────────────────────┬───────────────────────────────┤
│ Tx Hash             │ 0x1234...5678  [Copy] [Explore]│
│ Status              │ ● Confirmed (12 confirmations) │
│ Chain               │ Arbitrum (42161)               │
│ Block               │ #12345678 [Explore]            │
│ From                │ 0xABC...DEF                    │
│ To                  │ 0x123...456 (Uniswap V2 Router)│
│ Nonce               │ 42                             │
│ Gas Limit           │ 250,000                        │
│ Gas Used            │ 198,432 (79.4%)                │
│ Gas Price           │ 0.1 Gwei                       │
│ Max Fee             │ 0.15 Gwei                      │
│ Priority Fee        │ 0.01 Gwei                      │
│ Gas Cost USD        │ $0.03                          │
│ Value               │ 0.05 ETH ($125.00)             │
│ Submitted           │ 2026-05-15 15:30:00 UTC        │
│ Confirmed           │ 2026-05-15 15:30:02 UTC        │
│ Revert Reason       │ (none)                         │
└─────────────────────┴───────────────────────────────┘
```

#### 2.4 DEX Metadata Section

```
┌─────────────────────────────────────────────────────┐
│ DEX Metadata                                        │
├─────────────────────┬───────────────────────────────┤
│ DEX Adapter         │ uniswap-v2                     │
│ Pool Address        │ 0xABC...DEF [Explore]          │
│ Router Address      │ 0x123...456                    │
│ Slippage Tolerance  │ 0.5% (50 bps)                  │
│ Deadline            │ 30 minutes                     │
│ MEV Risk            │ Low (no sandwich detected)     │
│ Route Path          │ WETH → USDC (direct)           │
└─────────────────────┴───────────────────────────────┘
```

## 3. Dashboard DEX Widget

### Location: `/dashboard`

A new widget card in the dashboard grid showing DEX health and aggregate stats.

### Widget: DEX Health Summary

```
┌──────────────────────────────────┐
│ DEX Status               [→]    │
├──────────────────────────────────┤
│ ● Healthy                       │
│                                 │
│ Chains:                         │
│  Arbitrum ●  Base ●  BNB ●     │
│                                 │
│ Today:                          │
│  Trades: 12  Success: 11        │
│  Pending: 1  Failed: 0         │
│  Gas (24h): $3.42               │
│                                 │
│ [View Details →]                │
└──────────────────────────────────┘
```

### Data Source

```
GET /api/operator/health/dex          → DEX health (existing BFF)
GET /api/operator/dashboard/dex-stats  → aggregate DEX stats (NEW BFF)
```

### Aggregate Stats Response

```typescript
type DexDashboardStats = {
  readonly healthStatus: 'healthy' | 'degraded' | 'down';
  readonly chains: ReadonlyArray<{
    readonly chainId: number;
    readonly name: string;
    readonly status: 'healthy' | 'degraded' | 'down';
  }>;
  readonly trades24h: {
    readonly total: number;
    readonly success: number;
    readonly pending: number;
    readonly failed: number;
    readonly reverted: number;
  };
  readonly gas24h: {
    readonly totalCostUsd: string;
    readonly avgPerTradeUsd: string;
  };
};
```

## 4. Settings — DEX Configuration

### Location: `/settings` → DEX tab

New tab in the settings workspace for DEX-specific configuration.

### 4.1 DEX Limits Editor

Edit `dex.limits` config key via config-service BFF:

- Global toggle (enabled/disabled)
- Per-chain toggle with gas limits
- Capital limits (maxNotional, maxDaily, maxPositions)
- Slippage tolerance slider
- Kill switch (destructive action — requires two-step approval)

### 4.2 DEX Live Configuration

Edit `dex.live` config key:

- Live trading toggle (destructive — requires `DestructiveOperatorAction`)
- Dry run mode toggle
- Paper parallel mode toggle
- Auto-hedge / auto-unwind toggles

### 4.3 DEX Filters

Display and edit `dex.filters` config key (already partially implemented via `DexFiltersPanel`):

- Threshold filters (spread, profit, fees)
- Volume filters
- Token whitelist/blacklist
- Risk filters

## 5. Chain-Specific Visual Elements

### Chain Icons & Colors

| Chain | chainId | Color | Icon |
|-------|---------|-------|------|
| Arbitrum | 42161 | `#28A0F0` (blue) | Arbitrum logo |
| Base | 8453 | `#0052FF` (blue) | Base logo |
| BNB Chain | 56 | `#F3BA2F` (yellow) | BNB logo |

### Block Explorer Links

| Chain | Tx URL | Address URL |
|-------|--------|-------------|
| Arbitrum | `https://arbiscan.io/tx/{txHash}` | `https://arbiscan.io/address/{address}` |
| Base | `https://basescan.org/tx/{txHash}` | `https://basescan.org/address/{address}` |
| BNB | `https://bscscan.com/tx/{txHash}` | `https://bscscan.com/address/{address}` |

### DEX Adapter Display Names

| Adapter Key | Display Name | Chain |
|-------------|-------------|-------|
| `uniV2` | Uniswap V2 | Arbitrum |
| `uniV3` | Uniswap V3 | Arbitrum, Base |
| `sushi` | SushiSwap | Arbitrum |
| `pancakeV2` | PancakeSwap V2 | BNB |
| `biswapV2` | Biswap V2 | BNB |

## 6. Operator Actions (DEX-Specific)

### 6.1 Speed Up Transaction (Pending TX)

**Trigger:** Pending transaction > 15 minutes  
**Flow:**
1. Operator clicks "Speed Up" on pending tx in execution detail
2. Impact preview: shows current gas → new gas (10-20% increase), estimated cost
3. `DestructiveOperatorAction` confirmation dialog
4. BFF `POST /api/operator/execution/plans/:planId/legs/:legId/speed-up`
5. Backend submits replacement tx with higher gas

### 6.2 Cancel Transaction (Pending TX)

**Trigger:** Pending transaction needs cancellation  
**Flow:**
1. Operator clicks "Cancel" on pending tx
2. Impact preview: leg will transition to `failed`, plan may `fail`
3. `DestructiveOperatorAction` confirmation dialog
4. BFF `POST /api/operator/execution/plans/:planId/legs/:legId/cancel-tx`
5. Backend submits cancellation tx (zero-value self-transfer)

### 6.3 Kill Switch

**Trigger:** Emergency stop all DEX trading  
**Flow:**
1. Operator clicks "Kill Switch" in DEX settings or dashboard widget
2. Full impact preview: all pending trades, open positions, current exposure
3. `DestructiveOperatorAction` with explicit "I understand this will halt all DEX trading" checkbox
4. BFF updates `dex.limits.killSwitch = true` via config-service

## 7. BFF Routes (New)

| Method | Path | Upstream | Description |
|--------|------|----------|-------------|
| GET | `/api/operator/execution/plans/:id/on-chain-txs` | `execution-orchestrator` | All on-chain txs for a plan |
| GET | `/api/operator/execution/legs/:legId/on-chain-txs` | `execution-orchestrator` | On-chain txs for a specific leg |
| GET | `/api/operator/dashboard/dex-stats` | `execution-orchestrator` | Aggregate DEX stats for dashboard |
| POST | `/api/operator/execution/plans/:id/legs/:legId/speed-up` | `execution-orchestrator` | Speed up pending tx (operator approval) |
| POST | `/api/operator/execution/plans/:id/legs/:legId/cancel-tx` | `execution-orchestrator` | Cancel pending tx (operator approval) |

## 8. React Query Integration

### New Query Keys

```typescript
const operatorKeys = {
  // ... existing keys ...
  executionPlanDetail: (id: string) => ['operator', 'execution', 'plans', id] as const,
  executionPlanOnChainTxs: (planId: string) => ['operator', 'execution', 'plans', planId, 'on-chain-txs'] as const,
  legOnChainTxs: (legId: string) => ['operator', 'execution', 'legs', legId, 'on-chain-txs'] as const,
  dexDashboardStats: () => ['operator', 'dashboard', 'dex-stats'] as const,
  dexLimits: () => ['operator', 'settings', 'dex', 'limits'] as const,
  dexLive: () => ['operator', 'settings', 'dex', 'live'] as const,
};
```

### Invalidation Strategy

- On `speed-up` or `cancel-tx` mutation → invalidate `executionPlanOnChainTxs`, `executionPlanDetail`
- On DEX config mutation → invalidate `dexLimits`, `dexLive`, `dexDashboardStats`
- On kill switch → invalidate all DEX queries + `dashboardSummary`

## 9. Implementation Priority

| Priority | Component | Complexity | Depends On |
|----------|-----------|------------|------------|
| P1 | Execution table DEX columns (venueType, chainId, txStatus) | Low | API extension on execution-orchestrator |
| P1 | Chain icons & block explorer links utility | Low | None |
| P2 | Execution plan detail view | Medium | New BFF routes, API extensions |
| P2 | On-chain tx detail card | Medium | BFF route for leg on-chain txs |
| P2 | Dashboard DEX health widget | Medium | New aggregate stats BFF |
| P3 | DEX settings tab (limits + live + filters) | Medium | Existing config BFF |
| P3 | Speed up / cancel operator actions | High | New mutation BFF routes, operator approval flow |

## 10. Accessibility & UX

- All DEX-specific badges must have ARIA labels (e.g., `aria-label="Transaction status: confirmed"`)
- Block explorer links open in new tab with `rel="noopener noreferrer"`
- Gas costs always shown in both native token and USD
- Timestamps in UTC with relative format ("2 minutes ago")
- Destructive actions (kill switch, cancel tx) must use `DestructiveOperatorAction` component
- Pending transactions auto-refresh every 15 seconds

## Related Documentation

- [DEX Runbook: Failed/Stuck Transactions](./dex-runbook-failed-tx.md)
- [DEX Live Mainnet Runbook](./dex-live-mainnet-runbook.md)
- [DEX Filters Config Keys](./dex-filters-config-keys.md)
- [Frontend Fixes Summary](../apps/web/FRONTEND_FIXES_SUMMARY.md)
- [Query Invalidation Strategy](../apps/web/QUERY_INVALIDATION.md)
- [Approval Flow Component](../apps/web/components/README-APPROVAL-FLOW.md)
- [Stack Conventions](../apps/web/STACK-CONVENTIONS.md)