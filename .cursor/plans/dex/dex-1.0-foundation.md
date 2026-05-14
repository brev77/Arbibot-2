# DEX-1.0 — Архитектура и фундамент

> Все шаги в этом разделе → **`done`** ✅

---

## `DEX-1-0-ADR-STRUCTURE` — ADR: размещение DEX-компонентов

- **step_id:** `DEX-1-0-ADR-STRUCTURE`
- **status:** `done` ✅
- **review_passed_date:** 2026-04-29
- **outputs:** ADR в `docs/adr-dex-structure.md`, DI контур, single-writer boundaries для `on_chain_transactions`, `wallet_states`, `dex_pools`

---

## `DEX-1-0-TECH-CHOICE` — Технологический выбор: ethers.js

- **step_id:** `DEX-1-0-TECH-CHOICE`
- **status:** `done` ✅
- **review_passed_date:** 2026-04-29
- **outputs:** ethers.js v6.13.0 в `packages/nest-platform` и `apps/execution-orchestrator`; типы `ChainId`, `Address`, `TxHash`

---

## `DEX-1-0-ABIS` — Пакет `@arbibot/contracts-eth`

- **step_id:** `DEX-1-0-ABIS`
- **status:** `done` ✅
- **review_passed_date:** 2026-04-29
- **outputs:** ABI (UniV2/V3/Sushi/ERC20), адреса (Arbitrum/Base/BNB mainnet+testnet), типы `ChainId`, `Address`
- **post_review_fixes:** CI lint fix — убран `**/*.spec.ts` из tsconfig exclude (commit `dfb0cdb`)

---

## `DEX-1-0-RPC` — RPC-провайдер: failover, health

- **step_id:** `DEX-1-0-RPC`
- **status:** `done` ✅
- **review_passed_date:** 2026-04-29
- **outputs:** `RpcProviderManager` (6 сетей), Prometheus metrics, env vars `RPC_*_URL`
- **backlog items:** unit-тесты, `GET /health/rpc` endpoint

---

## `DEX-1-0-MIGRATIONS` — Миграции БД

- **step_id:** `DEX-1-0-MIGRATIONS`
- **status:** `done` ✅
- **review_passed_date:** 2026-04-29
- **outputs:** Migration `033_dex_on_chain.sql` — таблицы `on_chain_transactions`, `wallet_states`, `dex_pools`, `approvals` + индексы

---

## `DEX-1-0-POOL-DISCOVERY` — Pool discovery + кэш

- **step_id:** `DEX-1-0-POOL-DISCOVERY`
- **status:** `done` ✅
- **review_passed_date:** 2026-04-30
- **outputs:** `PoolDiscoveryService` (UniV2/V3), in-memory cache, Prometheus metrics, env vars `POOL_DISCOVERY_*`
- **backlog items:** unit-тесты

---

## `DEX-1-0-VAULT` — Key vault: шифрование, audit

- **step_id:** `DEX-1-0-VAULT`
- **status:** `done` ✅
- **review_passed_date:** 2026-04-29
- **outputs:** `KeyVaultService` (AES-256-GCM), `KeyVaultModule`, 20/20 unit tests
- **backlog items:** key rotation runbook

---

## `DEX-1-0-WALLET-MGT` — Управление кошельками

- **step_id:** `DEX-1-0-WALLET-MGT`
- **status:** `done` ✅
- **review_passed_date:** 2026-04-29
- **outputs:** `WalletManagerService` (3 стратегии), `ExecutionModule` DI, Prometheus metrics
- **backlog items:** unit-тесты

---

## `DEX-1-0-GAS` — Оценка газа, EIP-1559

- **step_id:** `DEX-1-0-GAS`
- **status:** `done` ✅
- **review_passed_date:** 2026-04-29
- **outputs:** `GasEstimatorService` (EIP-1559, per-chain overrides, policy), 15 unit tests

---

## `DEX-1-0-RISK-POLICIES` — DEX risk policies

- **step_id:** `DEX-1-0-RISK-POLICIES`
- **status:** `done` ✅
- **review_passed_date:** 2026-04-30
- **outputs:** `DexRiskPolicyService` (slippage, position size, protocol, volume checks), Prometheus metrics

---

## `DEX-1-0-FILTERS` — DEX Opportunity Filters

- **step_id:** `DEX-1-0-FILTERS`
- **status:** `done` ✅ (2026-04-28)
- **outputs:** Backend (opportunity-service), Frontend BFF + `DexFiltersPanel`, config seed `032_dex_filters_seed.sql`

---

## `DEX-1-0-ENV-EXAMPLE` — Env vars template

- **step_id:** `DEX-1-0-ENV-EXAMPLE`
- **status:** `done` ✅
- **review_passed_date:** 2026-04-29
- **outputs:** Обновлённый `.env.example` с RPC/GAS/VAULT/WALLET vars + security comments