# Cost Estimation Configuration Keys

Документация конфигурационных ключей для pre-trade учёта издержек (газ, проскальзывание, комиссии пула, комиссии моста) и plan-level cost gate.

## Overview

Система pre-trade оценки стоимости (`TradeCostEstimatorService` в `execution-orchestrator`) агрегирует все ожидаемые денежные потери multi-leg плана **до** отправки первого leg:

- **газ** — gas limit × EIP-1559 fee × native/USD (через `PriceOracleService`, Chainlink ETH/USD или BNB/USD);
- **проскальзывание** — price impact на резервах пула (через `SlippageProtectionService`);
- **комиссии пула** — feeBps × notional (UniV2 0.3%, UniV3 переменный tier);
- **комиссии моста** — relayer + protocol fee для cross-chain legs (Across API, Stargate LayerZero quote, Native gas).

Net profit = gross profit (из opportunity payload) − total cost. Plan-level gate блокирует live-планы, чей net profit ниже `minNetProfitUsd`.

**Архитектурные инварианты:**
- **Single-writer:** estimator живёт в `execution-orchestrator` (владелец `ExecutionPlan`/`ExecutionLeg`); пишет cost breakdown только туда.
- **Paper/live isolation:** live-план блокируется по net<порога; paper-план — soft warning (metric+log), без блокировки (изоляция структурная через venueKey).
- **Fail-closed:** при невозможности оценить стоимость live leg (price oracle null, RPC down) gate блокирует план.

## Config Keys

### `dex.limits.minNetProfitUsd`

Минимальный net profit (USD), который план должен получить ПОСЛЕ вычета всех оценённых издержек, чтобы plan-level cost gate разрешил submit.

- **Key:** `dex.limits` (поле `minNetProfitUsd` внутри JSON)
- **Scope:** global / environment / tenant (CFG-3)
- **Type:** number (USD)
- **Default:** `0.5` (conservative; миграция 049)
- **Sensitive:** false (`dex.limits` помечен sensitive, требует `approveReason`)
- **Env override:** `DEX_MIN_NET_PROFIT_USD` (LOWER-BOUND: env может только повысить порог = сделать строже, никогда не ослабить)
- **Writer:** config-service (оператор / hermes-safe keys)
- **Reader:** `execution-orchestrator` → `DexRiskPolicyService.getEffectiveConfig()` → `TradeCostEstimatorService.evaluatePlanGate()`

```json
{
  "enabled": false,
  "maxNotionalPerTradeUsd": 500,
  "maxDailyNotionalUsd": 5000,
  "maxSlippageBps": 50,
  "minNetProfitUsd": 0.5
}
```

## Persistence (migration 048)

- `execution_plans.cost_breakdown` (jsonb) — полный `PlanCostBreakdown` (per-leg + totals + gross/net profit). Single-writer: `execution-orchestrator`. Partial index `WHERE cost_breakdown IS NOT NULL`.
- `execution_legs` typed columns: `estimated_gas_usd`, `slippage_bps`, `pool_fee_usd`, `bridge_fee_usd`, `total_cost_usd`, `cost_confidence` (`exact` | `modeled` | `unavailable`).

## Env Variables

| Variable | Default | Описание |
|----------|---------|----------|
| `DEX_MIN_NET_PROFIT_USD` | — | LOWER-BOUND override для `minNetProfitUsd` (env может только повысить порог) |
| `MAX_GAS_PRICE_GWEI` | `50` | Gas policy cap (per-chain override: `GAS_POLICY_{CHAINID}_MAX_FEE_GWEI`) |
| `MAX_PRIORITY_FEE_GWEI` | `2` | EIP-1559 priority fee cap |
| `DEX_DEFAULT_SLIPPAGE_BPS` | `50` | Slippage tolerance по умолчанию (0.5%) |
| `DEX_MAX_SLIPPAGE_BPS` | — | LOWER-BOUND override для max slippage |

## Metrics

| Metric | Тип | Описание |
|--------|-----|----------|
| `arb_cost_gas_usd` | histogram | Gas cost в USD per leg (labels: chain_id, leg_type) |
| `arb_cost_slippage_bps` | histogram | Slippage в bps per DEX leg |
| `arb_cost_bridge_fee_usd` | histogram | Bridge fee в USD per bridge leg |
| `arb_cost_total_usd` | histogram | Total cost в USD per plan |
| `arb_cost_net_profit_usd` | histogram | Net profit в USD per plan (gross − total cost) |
| `arb_cost_gate_decisions_total` | counter | Cost-gate решения (labels: decision=allowed/blocked) |
| `arb_cost_estimate_failures_total` | counter | Сбои оценки (oracle/rpc unavailable) |
| `arb_dex_v3_quote_fallback_total` | counter | V3 amountOutMin fallbacks (QuoterV2 unavailable) |

## Flow

```
[beginExecution] (legs.service.ts)
  → TradeCostEstimatorService.estimatePlanCost(plan)
      per leg: gas (GasEstimator × PriceOracle) + slippage (SlippageProtection)
               + pool fee (DiscoveredPool.feeBps) + bridge fee (adapter.estimateBridgeFee)
      → aggregate totals, gross/net profit
  → persist cost_breakdown (plan + per-leg columns)
  → if hasLiveLeg: evaluatePlanGate(breakdown)
      → fail-closed if confidence=unavailable
      → block if netProfitUsd < minNetProfitUsd
[markSent → submitLeg] (per leg)
  → enforceLiveRiskGate (now with real estimatedGasCostUsd via GasEstimator)
```
