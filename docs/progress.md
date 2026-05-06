# Progress Arbibot 2

**Обновлено:** 2026-05-06

---

## Текущий статус

**DEX план:** 20/35 done. RECON-ONCHAIN reviewed → done.
**Текущий шаг:** `DEX-1-2-OUTBOX-EVENTS` (next to implement)
**Следующие:** `DEX-1-2-OUTBOX-EVENTS`, `DEX-1-2-HEALTH`, `DEX-1-2-OBS`

**Build:** 21/21 ✅ | **Lint:** 28/28 ✅ | **Fill tracker tests:** 9/9 ✅

---

## Незавершённые задачи

### Высокий приоритет
1. **DEX-1-2-OUTBOX-EVENTS** → `planned` — следующий к реализации
2. **DEX-1-2:** `HEALTH`, `OBS`, `MEMPOOL`
3. **CI зелёный на GitHub Actions** — не верифицирован

### Средний приоритет
4. **Pre-existing test issues** (execution-orchestrator):
   - `plans.service.spec.ts` — TS type error (playbookConfig optional)
   - `wallet-manager.service.spec.ts` — TS type error (ChainId)
   - `rpc-provider-manager.service.spec.ts` — Prometheus metric re-registration
5. **Недостающие unit-тесты:** `PoolDiscoveryService`, `RpcProviderManager`

### Низкий приоритет
6. **Bus E2E:** полный сценарий с реальными событиями — backlog
7. **No testnet fork интеграционных тестов** для DEX адаптеров

---

## Последние события (2026-05)

### 2026-05-06 — DEX-1-2-RECON-ONCHAIN → done ✅ (session 11)
**Статус:** done (review passed)
**Задача:** `/review-step` DEX-1-2-RECON-ONCHAIN — DEX reconciliation detectors

- Три DEX-детектора: `dex_receipt_leg_mismatch`, `wallet_balance_drift`, `dex_stale_pending_tx`
- Чистое разделение CEX/DEX детекторов, idempotent inserts
- Configurable thresholds: `stalePendingHours` (default 1), `balanceDriftHours` (default 24)
- Unit tests: **7/7 passed** (reconciliation-service)
- DEX план: **20/35 done**

**Изменённые файлы:**
- `apps/reconciliation-service/src/mismatches/dex-reconciliation.detectors.ts` (новый)
- `apps/reconciliation-service/src/mismatches/dex-reconciliation.detectors.spec.ts` (новый)
- `apps/reconciliation-service/src/mismatches/mismatches.service.ts` (интеграция runDexDetectors)
- `apps/reconciliation-service/src/mismatches/mismatches.service.spec.ts`
- `.cursor/plans/DEVELOPMENT_PLAN-DEX.md` (RECON-ONCHAIN → done)
- `docs/progress.md` (статус обновлён)

**Следующие шаги:** `DEX-1-2-OUTBOX-EVENTS`, `DEX-1-2-HEALTH`, `DEX-1-2-OBS`

### 2026-05-06 — DEX-1-2-FILL-TRACKING → done ✅
**Статус:** done (review passed session 8)

- `DexFillTrackerService` — receipt → fill связывание
- `LegFilledPayloadV2` с optional dex metadata (txHash, chainId, gasUsed, from, to, protocolVersion)
- `OnChainTransaction.legId` тип изменён: bigint → uuid (migration 034)
- Backward compatible: `applyFill()` без dex metadata → v1 payload
- DI: `ExecutionModule`, без breaking changes
- Unit tests: **9/9 passed**
- Build: **21/21** ✅

**Созданные файлы:**
- `apps/execution-orchestrator/src/execution/dex-fill-tracker.service.ts`
- `apps/execution-orchestrator/src/execution/dex-fill-tracker.service.spec.ts`
- `infra/postgres/migrations/034_on_chain_tx_leg_id_uuid.sql`

**Изменённые файлы:**
- `packages/contracts/src/events.ts` (LegFilledPayloadV2)
- `packages/persistence/src/on-chain-transaction.entity.ts` (legId: uuid)
- `apps/execution-orchestrator/src/legs/legs.service.ts` (dex metadata integration)
- `apps/execution-orchestrator/src/execution/execution.module.ts` (DI)

### 2026-05-05 — DEX-1-1-ADAPTER-SUSHI → done ✅
**Статус:** done (review passed session 6)

- Review: build 21/21 ✅, Sushi 19/19 ✅, architecture guard + backend review PASS
- 3 pre-existing test failures (не связаны с SUSHI)

- `SushiSwapV2Adapter` — `swapExactTokensForTokens` через ethers.js
- Shared utils с UniV2: `extractSwapParams`, `applySlippage`, `getSlippageBps`, `ensureApproval`
- Router addresses: Arbitrum SushiSwap (`0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506`), BNB PancakeSwap (`0x10ED43C718714eb63d5aA57B78B54704E256024E`)
- Base chain → `VenueSubmitClientError` (no SushiSwap deployment)
- DI: `VenueFactoryService` обновлён (venueKey `sushiswap` → SushiSwapV2Adapter)
- Unit tests: **19/19 passed**
- Prometheus metrics: `arb_dex_sushiswap_v2_swap_total`, `arb_dex_sushiswap_v2_swap_latency_seconds`

**Созданные файлы:**
- `apps/execution-orchestrator/src/execution/adapters/sushiswap-v2.adapter.ts`
- `apps/execution-orchestrator/src/execution/adapters/sushiswap-v2.adapter.spec.ts`

**Изменённые файлы:**
- `apps/execution-orchestrator/src/execution/adapters/uniswap-v2.adapter.ts` (export `extractSwapParams`)
- `apps/execution-orchestrator/src/execution/execution.module.ts` (DI: SushiSwapV2Adapter)
- `apps/execution-orchestrator/src/execution/venue-factory.service.ts` (venueKey `sushiswap`)
- `apps/execution-orchestrator/src/execution/venue-factory.service.spec.ts` (SushiSwap tests)
- `apps/execution-orchestrator/src/legs/legs.module.ts` (DI: SushiSwapV2Adapter)

### 2026-05-05 — DEX-1-1-VENUE-BIND → done
- `VenueFactoryService` — фабрика адаптеров по venueKey
- `extractVenueKey(plan, leg?)` → `resolveAdapter(venueKey)` → `submitLeg(plan, leg)`
- Feature flag `DEX_VENUE_ENABLED` для DEX-адаптеров
- Unit tests: 21/21 ✅

### 2026-05-05 — DEX-1-1-ADAPTER-UNI3 → done
- `UniswapV3Adapter` — `exactInputSingle` (function selector `04e45aaf`)
- `fee` default 3000, `sqrtPriceLimitX96` optional
- Unit tests: 21/21 ✅

### 2026-05-05 — Репозиторий перенесён из OneDrive
- `.git` пересоздан, удалено 28 файлов-дубликатов OneDrive
- `C:\Coding\Arbibot-2` — чистый клон

### 2026-05-04 — DEX-1-1-ADAPTER-UNI2 → done
- `UniswapV2Adapter` — `swapExactTokensForTokens`, ERC20 approve, gas policy
- Router: Arbitrum SushiSwapV2, Base SushiSwapV2, BNB PancakeV2
- Unit tests: 21/21 ✅

### 2026-05-04 — CI fixes (4 шт) + git-workflow-agent skill
- `032_dex_filters_seed.sql` — исправлены колонки
- `ci-e2e-phase2.sh` — PRIVATE_KEY_ENCRYPTION_KEY default
- `contracts-eth` — smoke test (3/3)
- `turbo.json` — `lint` зависит от `^build`
- `.cursor/skills/git-workflow-agent/SKILL.md` — новый skill

---

## Архив (краткое резюме)

### DEX-1.0 Execution Services (2026-04-30)
Прежде чем ответить придумай как ты проверишь свой ответ.
Сессия заканчивается. Сделай следующее:
1. /compact "Focus: изменённые файлы, принятые решения, открытые вопросы"
2. Добавь summary в docs/progress.md (формат: дата, задача, статус, след. шаги)
3. Сохрани session_summary.md с ключевыми решениями этой сессии
4. Актуализируй информацию plans/DEVELOPMENT_PLAN-DEX.md
5. Сделай коммит и пуш на ГИТ
Не удаляй и не перезаписывай предыдущие записи в progress.md — только append.- `RpcProviderManager`, `GasEstimatorService`, `WalletManagerService`, `KeyVaultService` (20 tests)
- `PoolDiscoveryService`, `DexRiskPolicyService`, `TokenApproveService`, `SlippageProtectionService`
- `ExecutionModule` — DI registration, `RpcHealthController`

### DEX-1.0 Foundation (2026-04-29)
- `@arbibot/contracts-eth` — ABI UniV2/V3/Sushi + ERC20, адреса Arbitrum/Base/BNB
- 3 blocker fixes: `getEncryptedKey`, `ExecutionModule`, `KeyVaultService` (aes-256-gcm)

### CI fixes (2026-04-30)
- ESLint fixes (5 шт), Docker health-cmd, bus-smoke build, turbo.json lint dependency

### Skills + Review-step (2026-04-30)
- `/review-step` реорганизован, DEX checks добавлены во все 3 скилла
- `git-workflow-agent` skill создан

### Phase 4 Complete (2026-04-20/21)
- Intake throttling (policy cache, 429, metrics)
- Route scoring replay + export
- Degraded UI signals + Grafana dashboards

### Phase 5 OpenClaw Complete
- Read-only API, mutations, `/openclaw` UI, BFF proxy

### Phase 3 Paper Trading Complete
- Paper trades/promotion mutations, virtual capital, discovery pipeline, drift gauges
- E2E tests + CI jobs

### Config Service (CFG-1/2/3)
- NestJS + Fastify, Redis cache, staged rollout, per-scope overrides

### Phase 2 Policy Writers
- Watchlist tiering + route scoring writers, policy jobs, E2E + CI

---

## Правило поддержания файла (≤500 строк)

Когда файл превышает 500 строк:
1. Суммаризировать завершённые задачи старше 1 месяца в архивный блок
2. Удалять подробности реализаций (списки файлов, env vars)
3. Сохранять только: текущие задачи, события за последний месяц, архитектурные решения
4. Архивировать старую историю в `session_summary.md`

---

---

## 2026-05-05 (session 5) — DEX-1-1-ADAPTER-SUSHI → implemented

**Дата:** 2026-05-05 23:15
**Задача:** DEX-1-1-ADAPTER-SUSHI — `/review-step` → done
**Статус:** `done` ✅ (review passed)
**След. шаги:** `DEX-1-2-FILL-TRACKING`

### Принятые решения
1. `SushiSwapV2Adapter` наследует паттерн UniV2: `swapExactTokensForTokens` через ethers.js
2. Shared utils с UniV2: `extractSwapParams` экспортирован из `uniswap-v2.adapter.ts`
3. Router addresses: Arbitrum SushiSwap `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506`, BNB PancakeSwap `0x10ED43C718714eb63d5aA57B78B54704E256024E`
4. Base chain → `VenueSubmitClientError` (no SushiSwap deployment)
5. `VenueFactoryService` обновлён: venueKey `sushiswap` → SushiSwapV2Adapter

### Изменённые файлы
- **Новые:** `sushiswap-v2.adapter.ts`, `sushiswap-v2.adapter.spec.ts`
- **Изменённые:** `uniswap-v2.adapter.ts`, `execution.module.ts`, `venue-factory.service.ts`, `venue-factory.service.spec.ts`, `legs.module.ts`, `AGENTS.md`

### Результаты проверки
- Build: 21/21 ✅
- Tests: 19/19 ✅
- Lint: 0 errors

### Открытые вопросы
- CI зелёный на GitHub Actions не верифицирован
- 3 pre-existing test issues в execution-orchestrator (plans.service.spec, wallet-manager.service.spec, rpc-provider-manager.service.spec)
- Недостающие unit-тесты: PoolDiscoveryService, RpcProviderManager

---
(архив и справочная информация — в начале файла)

**Total migrations:** 001–034
**CI jobs:** build, lint, test, e2e-phase2, e2e-phase2-watchlist-route-scoring, e2e-phase3-paper-promotion, e2e-phase3-paper-discovery, e2e-phase4-tier-routing, bus-smoke

---

## 2026-05-06 (session 10) — DEX-1-2-RECON-ONCHAIN → implemented

**Дата:** 2026-05-06 20:25
**Задача:** DEX-1-2-RECON-ONCHAIN — DEX reconciliation detectors
**Статус:** `implemented` (awaiting review)
**След. шаги:** `/review-step` → `DEX-1-2-MEMPOOL`

### Принятые решения
1. Три DEX-детектора в одном файле `dex-reconciliation.detectors.ts`
2. Пороги конфигурируемые: `stalePendingHours`, `balanceDriftHours`
3. Интеграция через `runDexDetectors()` в `MismatchesService`

### Созданные файлы
- `apps/reconciliation-service/src/mismatches/dex-reconciliation.detectors.ts`
- `apps/reconciliation-service/src/mismatches/dex-reconciliation.detectors.spec.ts`

### Изменённые файлы
- `apps/reconciliation-service/src/mismatches/mismatches.service.ts`
- `apps/reconciliation-service/src/mismatches/mismatches.service.spec.ts`
- `.cursor/plans/DEVELOPMENT_PLAN-DEX.md`

### Результаты проверки
- Unit tests: 7/7 ✅ (4 detector + 3 integration)
- Build reconciliation-service: ✅

---

## 2026-05-06 (session 9) — ESLint projectService fix + lint cleanup

**Дата:** 2026-05-06 20:10
**Задача:** Исправить CI lint ошибку в `@arbibot/contracts-eth` + связанные lint ошибки
**Статус:** `done` ✅
**След. шаги:** `DEX-1-2-RECON-ONCHAIN`

### Описание проблемы
CI падал с ошибкой:
```
Parsing error: packages/contracts-eth/src/index.spec.ts was not found by the project service
```

### Принятые решения
1. **Root cause:** `eslint.config.mjs` содержал `projectService: true` — это имя параметра, а не булево значение. Правильный параметр: `project: true`.
2. **`projectService: true` → `project: true`** — говорит typescript-eslint автоматически искать ближайший tsconfig.json
3. **Добавлен override `unbound-method: off`** для `*.spec.ts` (Jest mock-объекты вызывают false positive)
4. **Удалён unused import** `DexFillTrackerService` из `legs.service.ts`
5. **Исправлен `venue-factory.service.ts`:**
   - Убран ненужный type assertion `(config as Record<string, unknown>).venueKey` → `config.venueKey`
   - Исправлен `never` в template literal для default case — использован `String(key)`

### Изменённые файлы
- **`eslint.config.mjs`** — `projectService: true` → `project: true`; override для spec-файлов
- **`apps/execution-orchestrator/src/legs/legs.service.ts`** — удалён unused import
- **`apps/execution-orchestrator/src/execution/venue-factory.service.ts`** — type assertion + template literal fix

### Результаты проверки
- `npm run lint -w @arbibot/contracts-eth` ✅ (0 errors, 0 warnings)
- `npm run lint -w @arbibot/execution-orchestrator` ✅ (0 errors, 23 pre-existing warnings)
- `turbo build` для обоих пакетов ✅ (7/7 successful)

### Открытые вопросы
- CI зелёный на GitHub Actions не верифицирован (должен пройти после push)
- 23 pre-existing `no-explicit-any` warnings в execution-orchestrator (DEX код)
- 3 unused eslint-disable directives в `wallet-manager.service.spec.ts` (ранее добавленные для unbound-method)
