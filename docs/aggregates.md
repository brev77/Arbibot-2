# Агрегаты: владелец, хранилище, concurrency (P0-0.1-AGG)

> **Верифицировано 2026-08-11** против production БД (Aéza, commit `1a7894b`) и
> миграций `001–057` (055–057 — probe-миграции, добавлены после верификации). Single-writer границы — канон для `architecture-guard-agent`.

| Агрегат | Single-writer сервис | Хранилище (OLTP) | Optimistic concurrency |
|---------|----------------------|------------------|-------------------------|
| **ArbitrageOpportunity** | opportunity-service | `arbitrage_opportunities` | `entity_version` (integer), compare-and-set при переходах. Колонки PLAN10: `live_execution_plan_id` (migration 054, dedup-маркер LiveAutoDriveWorker) |
| **RiskDecision** | risk-service | `risk_decisions` | `entity_version`; новые решения — insert-only, правки политик — отдельный поток |
| **CapitalReservation** | capital-service | `capital_reservations` | `entity_version` + статус; истечение TTL — отдельный переход. `UNIQUE(correlation_id)` (PLAN9 P9-9, migration 051) — идемпотентность |
| **ExecutionPlan** | execution-orchestrator | `execution_plans` | `entity_version` на плане. Колонки: `playbook_config` JSONB (migration 025, `legs[]` со swap params), `cost_breakdown` JSONB (migration 048, pre-trade cost estimate для plan-gate), `route_key` (migration 014) |
| **ExecutionLeg** | execution-orchestrator | `execution_legs` | `entity_version` на ноге; план — родитель. `submitting` state (PLAN9 P9-1, migration 052) — двухфазный mark-sent. Per-leg cost columns (migration 048): `estimated_gas_usd`, `slippage_bps`, `pool_fee_usd`, `bridge_fee_usd`, `total_cost_usd`, `cost_confidence` |
| **OnChainTransaction** | execution-orchestrator (`OnChainTransactionService.persistWithOutcome`, PLAN9 P9-2) | `on_chain_transactions` | single-writer с P9-2; persist atomic с `submitting → sent`. Колонки: `tx_hash`, `status` (`pending/confirmed/failed/reverted`), `input_data` (BYTEA, НЕ `calldata`), `gas_used`, `block_number`, `revert_reason`, `nonce`, `leg_id` (UUID, migration 034) |
| **PaperTrade** | paper-trading-service | `paper_trades` | settlement columns (PAD-2, migration 046): `entry_price`, `exit_price`, `profit_usd`, `settled_at` |
| **PaperCapitalReservation** | paper-trading-service (`PaperCapitalService`) | `paper_capital_reservations` | partial unique index `WHERE state='active'` (migration 050 hotfix). **Изолирована** от live `capital_reservations` |
| **BridgeTransfer** | execution-orchestrator (`BridgeTransferService`) | `bridge_transfers` | `status` (`pending/relaying/confirming/completed/failed/timed_out`), finality columns (migration 043) |
| **ScannerInstance / ScannerFinding** | scanner-service | `scanner_instances`, `scanner_findings` (migration 044) | runtime-status, не config (config — `scanner.defaults` / `scanner.instances` в `policy_configurations`, migration 045) |
| **WalletKey** | wallet:import CLI / KeyVaultService | `wallet_keys` (migration 042) | encrypted-at-rest AES-256-GCM, master key + per-deploy salt (`VAULT_MASTER_KEY_SALT`, P7-6) |
| **PolicyConfiguration** | config-service | `policy_configurations` | versioned (entity_version), scope fallback global→environment→tenant (migration 019/020), Redis cache |
| **AlertmanagerIncident** | alert pipeline | `alertmanager_incidents` (migration 038) | D4-A-2 paging tracking |
| **OutboxEvent** | сервис-владелец агрегата | `outbox_events` | `processed_at` NULL → dispatch (исключая dead-letter); `processed_at` только после успешного доменного эффекта; идемпотентность на уровне consumer (inbox). Scoped `paper_enqueue_idempotency_key` (migration 018). ⚠️ `processed_at` — shared колонка, race при пересекающихся allowlist (см. `outbox-inbox.md`) |
| **InboxEvent** | consuming service | `inbox_events` | unique (consumer, message_id) |
| **AuditLogEntry** | audit writer (platform) | `audit_log` | append-only, без CAS |

> ⚠️ **`cross_chain_reconciliation` таблицы не существует.** `CrossChainReconciliationService`
> — in-memory сервис (exposes через `bridge-recon.controller.ts`); reconciliation-таблица
> общего вида — `reconciliation_mismatches` (migration 011).

## Правила

- Ни один сервис кроме владельца не мутирует строки агрегата напрямую в БД.
- Чтение кросс-сервисно — через API или материализованные проекции (Phase 2+).
- `correlation_id` и `causation_id` проходят через sync и события для трассировки.
