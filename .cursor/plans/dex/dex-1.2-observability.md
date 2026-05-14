# DEX-1.2 — Сверка, observability, инциденты

> Все шаги в этом разделе → **`done`** ✅

---

## `DEX-1-2-RECON-ONCHAIN` — Reconciliation: receipt, баланс кошелька

- **step_id:** `DEX-1-2-RECON-ONCHAIN`
- **status:** `done` ✅
- **review_passed_date:** 2026-05-06
- **depends_on:** [`DEX-1-0-MIGRATIONS`, `DEX-1-0-RPC`]
- **outputs:** Три DEX-детектора (`dex_receipt_leg_mismatch`, `wallet_balance_drift`, `dex_stale_pending_tx`), configurable thresholds; 7/7 tests

---

## `DEX-1-2-FILL-TRACKING` — Fill tracking: receipt → fill events

- **step_id:** `DEX-1-2-FILL-TRACKING`
- **status:** `done` ✅
- **review_passed_date:** 2026-05-06
- **depends_on:** [`DEX-1-0-MIGRATIONS`, `DEX-1-0-RPC`]
- **outputs:** `DexFillTrackerService`, `LegFilledPayloadV2` с optional dex metadata, migration `034` (OnChainTransaction.legId bigint→uuid); 9/9 tests

---

## `DEX-1-2-MEMPOOL` — Mempool monitoring (MEV detection)

- **step_id:** `DEX-1-2-MEMPOOL`
- **status:** `done` ✅
- **review_passed_date:** 2026-05-10
- **depends_on:** [`DEX-1-0-RPC`, `DEX-1-0-ABIS`]
- **outputs:** `DexMempoolMonitorWorker` (frontrun/sandwich detection), risk score, feature flag `MEMPOOL_MONITOR_ENABLED`, `docs/dex-mev-threats.md`; 12/12 tests

---

## `DEX-1-2-OUTBOX-EVENTS` — Outbox-события для DEX

- **step_id:** `DEX-1-2-OUTBOX-EVENTS`
- **status:** `done` ✅
- **review_passed_date:** 2026-05-06
- **depends_on:** [`P1-1.1-OIB`, `DEX-1-0-MIGRATIONS`]
- **outputs:** 3 event types (`DexTransactionSubmitted`, `DexTransactionConfirmed`, `DexTransactionFailed`), `DexOutboxEventsService`, Kafka bridge allowlist updated; 10/10 tests

---

## `DEX-1-2-HEALTH` — Health endpoints

- **step_id:** `DEX-1-2-HEALTH`
- **status:** `done` ✅
- **review_passed_date:** 2026-05-10
- **depends_on:** [`DEX-1-0-RPC`, `DEX-1-0-VAULT`, `DEX-1-0-WALLET-MGT`]
- **outputs:** `DexHealthService` + `DexHealthController` (`GET /health/dex`, `GET /health/dex/bridges`), BFF route, `DexHealthBanner`; 9/9 tests

---

## `DEX-1-2-OBS` — Метрики: RPC, gas, success rate, SLO

- **step_id:** `DEX-1-2-OBS`
- **status:** `done` ✅
- **review_passed_date:** 2026-05-10
- **depends_on:** [`DEX-1-0-RPC`, `DEX-1-0-GAS`, `DEX-1-1-ADAPTER-UNI2`]
- **outputs:** `DexMetricsService` (6 Prometheus metrics + timer helpers), Grafana dashboard `arbibot-dex-overview.json` (11 panels), DEX SLO в `docs/observability-tracing.md`; 10/10 tests

---

## `DEX-1-2-LOAD-TEST` — Нагрузочное тестирование

- **step_id:** `DEX-1-2-LOAD-TEST`
- **status:** `done` ✅
- **review_passed_date:** 2026-05-10
- **depends_on:** [`DEX-1-0-RPC`, `DEX-1-0-VAULT`, `DEX-1-1-ADAPTER-UNI2`]
- **outputs:** `tools/dex-load-test.mjs` (3-phase: health warmup, concurrent submit, metrics scrape), `--dry-run` mode, configurable thresholds, `docs/dex-load-test-report.md`, `npm run dex:load-test`