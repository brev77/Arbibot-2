# Progress Arbibot 2

**Обновлено:** 2026-04-30 (CI fixes — ESLint, build, Docker health-cmd, bus-smoke, capital lint)

---

### 2026-04-30 ( поздно вечером) — CI Fix: 5 ошибок → green → done
**Статус:** done

**Задача:** Исправить все ошибки CI, выявленные после пуша в `main`.

**Исправленные ошибки (5 шт):**

1. ✅ **ESLint: `publish-snapshot-updated.spec.ts`** (строки 13, 20)
   - Заменил `as jest.MockedFunction<typeof ...>` на `jest.mocked()`
   - Убран неиспользованный импорт `LockedOutboxRow`
2. ✅ **Build TS2307: `wallet-state.entity.ts` → `@arbibot/contracts-eth`**
   - Добавлен `"@arbibot/contracts-eth": "*"` в `packages/persistence/package.json`
3. ✅ **Docker `--health-cmd`** в CI YAML (3 job'а)
   - `--health-cmd "pg_isready -U arbibot -d arbibot"` — кавычки
4. ✅ **Bus-smoke: отсутствовал `npm run build`**
   - Добавлен шаг build перед `ci-bus-smoke.sh`
5. ✅ **ESLint: `capital.service.spec.ts`** (no-redundant-type-constituents)
   - Тип параметра `entity: CapitalReservationEntity | OutboxEventEntity` → `Record<string, unknown>`

**Изменённые файлы:**
- `packages/outbox-kafka-bridge/src/publish-snapshot-updated.spec.ts`
- `packages/persistence/package.json`
- `.github/workflows/ci.yml`
- `apps/capital-service/src/capital/capital.service.spec.ts`

**Git:** `6d80aa6` (fix 1-4) → `893032e` (fix 5) → `origin/main`

**Верификация:**
- `npm run lint` — 21/21 ✅ (0 errors)
- `npm run build` — 21/21 ✅

**Следующие шаги:**
1. Проверить CI зелёный на GitHub Actions
2. Продолжить DEX-1-1-ADAPTER-UNI2

---

### 2026-04-30 (вечер) — Review-step orchestration + Skills update → done
**Статус:** done

**Задача:** Реорганизовать `/review-step` команду и обновить все три Cursor-скилла под DEX план.

**Выполнено:**
1. ✅ `.cursor/commands/review-step.md` — реорганизован:
   - Приоритет планов: `DEVELOPMENT_PLAN-DEX.md` (активный) → `DEVELOPMENT_PLAN.md` (архивный, не редактировать без запроса)
   - Таблица обязательных скиллов с путями и условиями запуска
   - DEX-специфичные проверки для каждого скилла
   - Policy: не редактировать архивный план без запроса
2. ✅ `.cursor/skills/architecture-guard-agent/SKILL.md` — DEX invariants (12 проверок):
   - EOA-only, AES-256-GCM ключи, gas policy, on-chain entities, VenueAdapter
   - ethers.js v6 без `any`, RPC failover, slippage, approve idempotency
   - Paper/live изоляция, sequential DEX-1→DEX-2
3. ✅ `.cursor/skills/backend-review-agent/SKILL.md` — DEX backend checks (11 проверок):
   - RpcProviderManager, GasEstimatorService, KeyVaultService, WalletManagerService
   - TokenApproveService, SlippageProtectionService, PoolDiscoveryService
   - DexRiskPolicyService, on-chain entities, env vars
4. ✅ `.cursor/skills/frontend-review-agent/SKILL.md` — DEX frontend checks (7 проверок):
   - DEX filters panel, wallet management UI, health banners
   - On-chain tx display, bridge status, ConfigService integration, query keys

**Изменённые файлы:**
- `.cursor/commands/review-step.md` (переписан)
- `.cursor/skills/architecture-guard-agent/SKILL.md` (переписан)
- `.cursor/skills/backend-review-agent/SKILL.md` (переписан)
- `.cursor/skills/frontend-review-agent/SKILL.md` (переписан)

**Git:** `aae6d04` → `origin/main` (18 files, +1844/-103)

**Следующие шаги:**
1. Пройти `/review-step` для одного из DEX-шагов (например DEX-1-0-RPC) для валидации нового процесса
2. Продолжить DEX-1.1: `DEX-1-1-ADAPTER-UNI2` (критический путь)
3. Добавить недостающие unit-тесты для PoolDiscoveryService, RpcProviderManager

---

### 2026-04-30 — DEX-1.0 Execution Services Sprint → done
**Статус:** done

**Задача:** Реализовать все DEX execution сервисы в `execution-orchestrator`.

**Выполнено:**
1. ✅ `RpcProviderManager` — multi-chain RPC с failover, health-check, circuit breaker, метрики
2. ✅ `GasEstimatorService` — EIP-1559 gas estimation с multi-strategy fallback
3. ✅ `WalletManagerService` — round-robin wallet selection, balance checks, key rotation support
4. ✅ `KeyVaultService` — aes-256-gcm encryption, key lifecycle management (20/20 unit tests)
5. ✅ `PoolDiscoveryService` — on-chain DEX pool discovery (UniV2/V3), cache с TTL, Prometheus metrics
6. ✅ `DexRiskPolicyService` — DEX-specific risk checks (slippage, position size, protocol allowlist, daily volume)
7. ✅ `TokenApproveService` — ERC20 approve/revoke с safe pattern (revoke-then-approve)
8. ✅ `SlippageProtectionService` — constant product slippage estimation, max trade amount calculation
9. ✅ `RpcHealthController` — `GET /health/rpc` для мониторинга RPC провайдеров
10. ✅ Unit tests: `rpc-provider-manager.service.spec.ts`, `wallet-manager.service.spec.ts`
11. ✅ Runbook: `docs/key-rotation-runbook.md`
12. ✅ `ExecutionModule` — DI registration всех сервисов

**Созданные файлы:**
- `apps/execution-orchestrator/src/execution/rpc/rpc-provider-manager.service.ts`
- `apps/execution-orchestrator/src/execution/rpc/rpc-provider-manager.service.spec.ts`
- `apps/execution-orchestrator/src/execution/rpc/rpc-health.controller.ts`
- `apps/execution-orchestrator/src/execution/gas/gas-estimator.service.ts`
- `apps/execution-orchestrator/src/execution/gas/gas-estimator.service.spec.ts`
- `apps/execution-orchestrator/src/execution/wallet-manager.service.ts`
- `apps/execution-orchestrator/src/execution/wallet-manager.service.spec.ts`
- `apps/execution-orchestrator/src/execution/pool/pool-discovery.service.ts`
- `apps/execution-orchestrator/src/execution/risk/dex-risk-policy.service.ts`
- `apps/execution-orchestrator/src/execution/token/token-approve.service.ts`
- `apps/execution-orchestrator/src/execution/slippage/slippage-protection.service.ts`
- `apps/execution-orchestrator/src/execution/execution.module.ts` (updated)
- `docs/key-rotation-runbook.md`

**Prometheus metrics (новые):**
- `arb_rpc_failures_total`, `arb_rpc_latency_seconds`, `arb_rpc_circuit_breaker_state`
- `arb_gas_estimations_total`, `arb_gas_estimation_latency_seconds`
- `arb_wallet_selection_total`, `arb_wallet_insufficient_funds_total`
- `arb_dex_pools_discovered`, `arb_dex_pool_discovery_latency_seconds`, `arb_dex_pool_cache_hits_total`
- `arb_dex_risk_checks_total`, `arb_dex_risk_blocks_total`
- `arb_dex_token_approve_total`, `arb_dex_token_revoke_total`, `arb_dex_token_allowance`
- `arb_dex_slippage_estimates_total`, `arb_dex_slippage_blocked_total`, `arb_dex_slippage_bps`

**Новые env vars:**
- `RPC_*`, `WALLET_SELECTION_STRATEGY`, `POOL_DISCOVERY_ENABLED`, `POOL_CACHE_TTL_MS`, `DEX_MAX_SLIPPAGE_BPS`, `DEX_MAX_POSITION_SIZE_USD`, `DEX_MIN_POOL_LIQUIDITY_USD`

**Следующие шаги:**
1. `DEX-1-0-MIGRATIONS` — обновить миграции (on_chain_transactions, wallet_states, dex_pools, approvals)
2. Интеграция с config-service для динамической конфигурации DEX risk policies
3. E2E тест для DEX execution flow

---

### 2026-04-29 — DEX-1-0-TECH-CHOICE + DEX-1-0-ABIS → done
**Статус:** done

**Задача:** Закрыть `DEX-1-0-TECH-CHOICE` и реализовать `DEX-1-0-ABIS` — пакет `@arbibot/contracts-eth`.

**Выполнено:**
1. ✅ `DEX-1-0-TECH-CHOICE` → `done`: ethers.js v6.13.0 уже установлен, совместимость с Arbitrum/Base/BNB подтверждена
2. ✅ `DEX-1-0-ABIS` → `done`: создан пакет `@arbibot/contracts-eth` с:
   - ABI: `UniswapV2RouterABI`, `UniswapV3RouterABI`, `SushiSwapRouterABI`, `ERC20ABI`
   - Адреса: Arbitrum (mainnet + Sepolia), Base (mainnet + Sepolia), BNB Chain (mainnet + testnet)
   - Типы: `ChainId` enum (12 значений), `Address` branded type
3. ✅ Исправлен баг: убраны артефакты `</write_to_file>` из 5 файлов
4. ✅ DEX план обновлён (v1.1) — оба шага помечены `done` с review_notes

**Созданные файлы:**
- `packages/contracts-eth/package.json`, `tsconfig.json`, `tsconfig.build.json`
- `packages/contracts-eth/src/types/chain-id.ts`, `address.ts`
- `packages/contracts-eth/src/abis/uniswap-v2-router.ts`, `uniswap-v3-router.ts`, `sushiswap-router.ts`, `erc20.ts`
- `packages/contracts-eth/src/addresses/arbitrum.ts`, `base.ts`, `bnb.ts`
- `packages/contracts-eth/src/index.ts`

**Верификация:**
- `npm run build` → **21/21 пакетов green**

**Следующие шаги:**
1. `DEX-1-0-RPC` — RpcProviderManager (failover, health, метрики)
2. `DEX-1-0-MIGRATIONS` — таблицы `on_chain_transactions`, `wallet_states`, `dex_pools`, `approvals`
3. Синхронизировать статусы VAULT/WALLET-MGT после RPC+MIGRATIONS

---

### 2026-04-29 — DEX Blocker Fixes (3/3 resolved)
**Статус:** done

**Задача:** Исправить 3 критических DEX блокера, выявленных при code review.

**Исправленные блокеры:**
1. ✅ **Blocker 1:** `getEncryptedKey` реализован в `WalletManagerService` — делегирует к `KeyVaultService.retrieveEncryptedKey()`
2. ✅ **Blocker 2:** Создан `ExecutionModule` с DI-регистрацией `WalletManagerService`, `KeyVaultModule`, `TypeOrmModule.forFeature([WalletState])`; подключён к `AppModule`
3. ✅ **Blocker 3:** `KeyVaultService` переписан с корректной типизацией (aes-256-gcm, `Buffer` для crypto-операций, hex-строки для хранения/передачи)

**Дополнительные исправления:**
- `wallet-manager.service.ts`: strict mode fixes (non-null assertions, Address cast, убран `id` из `create()`)
- `dex-filters-config.dto.ts`: strict mode fix (definite assignment `!`)
- `KeyVaultModule` (Global) + экспорт через `@arbibot/nest-platform`
- 20/20 unit tests `key-vault.service.spec.ts` (encrypt/decrypt roundtrip, register/rotate/deactivate, metrics)

**Изменённые файлы:**
- `packages/nest-platform/src/vault/key-vault.service.ts` — полная реализация
- `packages/nest-platform/src/vault/key-vault.module.ts` — новый Global-модуль
- `packages/nest-platform/src/vault/key-vault.service.spec.ts` — 20 тестов
- `packages/nest-platform/src/vault/index.ts` — экспорт модуля
- `packages/nest-platform/src/index.ts` — экспорт модуля
- `apps/execution-orchestrator/src/execution/execution.module.ts` — новый DI-модуль
- `apps/execution-orchestrator/src/execution/wallet-manager.service.ts` — TS + getEncryptedKey fixes
- `apps/execution-orchestrator/src/app.module.ts` — подключение ExecutionModule
- `apps/opportunity-service/src/opportunities/dto/dex-filters-config.dto.ts` — strict mode

**Верификация:**
- `npm run build` → **21/21 пакетов green**
- `npm test -w @arbibot/nest-platform -- --testPathPatterns="key-vault"` → **20/20 passed**

**Следующие шаги:**
1. Пройти `/review-step` для FE-SETTINGS-POLICY-WORKSPACE
2. Проверить CI jobs на push

---

### 2026-04-29 — AGENTS.md синхронизация с состоянием проекта
**Статус:** done

**Задача:** Проверить актуальность AGENTS.md по данным docs/progress.md, session_summary.md, DEVELOPMENT_PLAN.md, docs/TODO.md.

**Принятые решения:**
1. AGENTS.md обновлён по 6 расхождениям (см. ниже)
2. Подтверждено: Phase 5 все формальные шаги `done` (P5-5-GW/OAPI/OCUI/BRIEF)
3. Подтверждено: миграции 001–032 (включая `032_dex_filters_seed.sql`)
4. DEX Code Review блокеры задокументированы в Known issues

**Изменённые файлы:**
- `AGENTS.md` — 6 обновлений:
  1. Current status дата: `2026-04-21` → `2026-04-28`
  2. Last major update: добавлены DEX Filters, DEX Code Review, FE-SETTINGS-POLICY-WORKSPACE, Phase 5 done
  3. Known issues: DEX 3 блокера + FE-SETTINGS awaiting review
  4. Новая секция «DEX Code Review & Filters (2026-04-28)»
  5. FE-SETTINGS-POLICY-WORKSPACE (`implemented`) секция добавлена
  6. Миграции 001–031 → 001–032 (2 места)

**Открытые вопросы:**
- `FE-SETTINGS-POLICY-WORKSPACE` → `implemented`, awaiting `/review-step` → `done`
- DEX 3 блокера не исправлены
- CI jobs на `main` не верифицированы

**Следующие шаги:**
1. Исправить 3 DEX блокера
2. Пройти `/review-step` для FE-SETTINGS-POLICY-WORKSPACE
3. Проверить CI jobs


---

### 2026-04-28 — DEX Code Review & Task Management Policy
**Статус:** done

**Основная задача:** Документирование результатов DEX code review и установление политик ведения задач.

**Критические блокеры (найдены при ревизии):**
1. 🔴 Blocker 1: `getEncryptedKey` не реализован в WalletManager (выбрасывает ошибку)
2. 🔴 Blocker 2: Сервисы не зарегистрированы в DI контуре (нет execution.module.ts)
3. 🔴 Blocker 3: Несоответствие типов encryptionKey в Vault (string vs Buffer)

**Принятые решения:**
1. **Task Management Policy:**
   - Все задачи по выполнению плана DEX → `.cursor/plans/DEVELOPMENT_PLAN-DEX.md` (секции: `review_notes` / `review_action_items` / `review_blocks`)
   - Задачи не из DEX плана → `docs/TODO.md`

2. **Documentation Strategy:**
   - Информация о ревизии кода хранится в DEVELOPMENT_PLAN-DEX.md
   - Отдельные файлы типа `dex-code-review-summary.md` не создаются
   - Progress.md хранит краткие записи о завершённых задачах

**Изменённые файлы:**
- `docs/TODO.md` — добавлены критические блокеры и политика ведения задач
- `.cursor/plans/DEVELOPMENT_PLAN-DEX.md` — добавлены review notes для реализованных шагов
- `docs/session_summary.md` — запись о сессии (будет добавлена отдельно)

**Рекомендация:** Приостановить разработку новых DEX фич, исправить 3 критических блокера, создать базовые unit tests.

**Следующие шаги:**
1. Исправить 3 критических блокера
2. Создать базовые unit tests для DEX компонентов
3. Продолжить разработку по плану DEX-1

---

<task_progress>
- [x] Создать фокусированное резюме сессии (condense)
- [x] Добавить запись в docs/progress.md (append only)
- [ ] Обновить session_summary.md с ключевыми решениями
- [ ] Завершить сессию
</task_progress>

## Правило поддержания файла (≤500 строк)

Когда файл превышает 500 строк:
1. Суммаризировать все завершённые задачи старше 1 месяца в один блок
2. Удалять подробности реализаций (списки файлов, технические детали, длинные секции "Реализовано")
3. Сохранять только:
   - Текущие незавершённые задачи
   - События за последний месяц
   - Архитектурные решения
4. Архивировать старую историю в `session_summary.md` или удалять

---

## Незавершённые задачи (приоритет: высокий → низкий)

### Важные (высокий приоритет)
1. **DEX Integration — Phase 0 (DEX-1-0-FILTERS):**
   - Определить конкретный список DEX-ов для MVP (продуктовое решение)
   - Backend фильтрация реализована, UI тестируется
   - Статус: await продуктового решения

2. **Bus E2E Testing:**
   - Полный сценарий bus publish/consume с заполненным `outbox_events` вне CI smoke
   - Требуется стенд с Redpanda и реальными событиями
   - Статус: базовый smoke реализован, полное E2E — backlog

### Средний приоритет
3. **Intake Policy UI:**
   - UI `/settings` для редактирования ключей `intake.*`
   - Статус: backend готов, read-through effective реализован

4. **Production Operations:**
   - Алерт «fallback > 5 min» для market-intake
   - Runbook для intake degradation
   - Статус: мониторинг готов, alert/runbook — по продукту

5. **Multi-instance OpenClaw:**
   - Проверка нагрузочного поведения при деградации Redis
   - Статус: базовый Redis safe mode реализован, стресс-тесты — backlog

### Рутинные (низкий приоритет)
6. **Migrations:**
   - Применить миграции 030/031/032 на всех БД
   - Проверка через `npm run db:verify-migrations:all`
   - Статус: миграции готовы, awaiting оператора

---

## Последние события (2026-04)

### 2026-04-28 — DEX Opportunity Filters System
**Статус:** done

Реализована система фильтрации DEX возможностей:
- Backend: `DexFiltersConfigDto`, методы `applyDexFilters()`, `previewDexFilters()`, `getDexFiltersMetrics()`
- Frontend: `DexFiltersPanel`, BFF routes для preview/metrics
- Migration: `032_dex_filters_seed.sql`
- Documentation: `docs/dex-filters-config-keys.md`

**Типы фильтров:** threshold (spread, profit, fees), volume, tokens, risk
**SLO:** Filter application < 10ms, Preview < 100ms

### 2026-04-27 — Анализ DEX-плана
**Статус:** done

- Проверена архитектурная совместимость с Arbibot 2
- Разработана методология самопроверки планов
- Обновлён план с фокусом на MVP

### 2026-04-21 — Production Sprint Complete
**Статус:** done

- CI parity (7 jobs)
- Migrations: `verify-migrations-applied.mjs` с `--all`
- OpenClaw multi-instance safe mode (Redis + fallback)
- Bus seed: `seed:outbox-smoke-events:all`
- HTTP venue 4xx taxonomy
- Intake policy UI (read-through)
- Закрыты: `PRIO-P2-PROMO`, `PRIO-P2-RECAL`

### 2026-04-20 — Phase 4 Complete
**Статус:** done

- **P4-4-TIER:** Intake throttling (policy cache, 429, metrics)
- **P4-4-SCORE:** Route scoring replay + export
- **P4-4-CH:** ADR для ClickHouse gate (без CH)
- **P4-4-UI:** Degraded banner, dashboard intake section

### 2026-04-20 — Phase 5 OpenClaw Complete
**Статус:** done

- **P5-5-GW:** Read-only API
- **P5-5-OAPI:** Mutations (arm/execute/resolve/safe-mode)
- **P5-5-OCUI:** Frontend `/openclaw` + BFF

---

## Архивные завершения (до 2026-04-19)

### Phase 3: Paper Trading Complete
- **P3-1/P3-2:** Paper trades/promotion mutations (UI)
- **P3-3:** Virtual capital (paper-only reservations)
- **P3-4:** Paper discovery pipeline (worker, E2E)
- **P3-5:** Drift gauges + recording rules
- **P3-6:** E2E tests + CI
- Migrations: 016, 017, 018, 021, 022, 023

### Phase 2.2: Policy Writers
- Watchlist tiering writer + route scoring writer
- Policy jobs service with HTTP triggers
- E2E tests + CI job

### Config Service (CFG-1/2/3)
- NestJS + Fastify service (port 3019)
- Redis cache + audit integration
- Staged rollout (promote/activate draft)
- Per-scope overrides + rollback

### Operator Dashboards
- Dashboard M2 (incidents, capital widgets)
- Paper quality improvements (Grafana dashboards)
- SLO v1 + on-call templates

### Frontend Architecture
- `DestructiveOperatorAction` component (two-step approval)
- React Query integration with invalidation strategy
- Tailwind migration from inline styles
- BFF routes for all services

### Observability
- Grafana dashboards: paper-trading, execution-latency
- Prometheus metrics integration
- Alert policies (drift, SLO violations)

### Additional
- Monorepo ESLint fixes (19 packages)
- Backend/frontend/architecture reviews
- AGENTS.md updates with Cursor skills
- Session compaction methodology

**Total migrations:** 001–033
**CI jobs:** build, lint, test, e2e-phase2, e2e-phase2-watchlist-route-scoring, e2e-phase3-paper-promotion, e2e-phase3-paper-discovery, e2e-phase4-tier-routing, bus-smoke

---

### 2026-05-04 — CI lint fix: contracts-eth tsconfig exclude → done
**Статус:** done

**Задача:** Исправить CI build failure — ESLint падал на `packages/contracts-eth/src/index.spec.ts` с ошибкой `was not found by the project service`.

**Корневая причина:** `packages/contracts-eth/tsconfig.json` содержал `"exclude": ["**/*.spec.ts"]` — ESLint glob `src/**/*.ts` находил spec-файл, но TypeScript Project Service не мог его обработать.

**Фикс:** Убран `"**/*.spec.ts"` из `exclude` в tsconfig.

**Изменённые файлы:**
- `packages/contracts-eth/tsconfig.json` (убран `"**/*.spec.ts"` из exclude)
- `AGENTS.md` (упрощена секция Windows path после переименования папки)

**Git:**
- Branch: `fix/ci-contracts-eth-lint`
- Commit: `dfb0cdb`
- Pushed to `origin`, PR: https://github.com/brev77/Arbibot-2/pull/new/fix/ci-contracts-eth-lint

**Верификация:**
- `npm run lint` — 28/28 ✅ (0 errors)
- `npm run build` — 21/21 ✅
- `npm run test -w @arbibot/contracts-eth` — 3/3 ✅

**Следующие шаги:**
1. Merge PR → main
2. Проверить CI зелёный на GitHub Actions
3. Продолжить `DEX-1-1-ADAPTER-UNI2` (критический путь)

---

### 2026-05-04 — DEX-1-1-ADAPTER-UNI2: UniswapV2Adapter → implemented
**Статус:** implemented (awaiting `/review-step` → `done`)

**Задача:** Реализовать UniswapV2-совместимый DEX-адаптер для `execution-orchestrator`.

**Выполнено:**
1. ✅ `UniswapV2Adapter` — реализация `VenueAdapter.submitLeg(plan, leg)` → `{ externalOrderId: txHash }`
2. ✅ `swapExactTokensForTokens` calldata через `ethers.js Interface.encodeFunctionData`
3. ✅ ERC20 approve: `ensureApproval()` — allowance check + approve при необходимости
4. ✅ On-chain quote: `calculateAmountOutMin()` через router `getAmountsOut` + slippage
5. ✅ Gas policy enforcement: reject при `withinPolicy: false`
6. ✅ Error hierarchy: `VenueSubmitClientError`, `VenueSubmitTransientError`, `VenueTerminalSubmitError`
7. ✅ Prometheus metrics: `arb_dex_uniswap_v2_swap_total`, `arb_dex_uniswap_v2_swap_latency_seconds`
8. ✅ DI: зарегистрирован в `ExecutionModule`
9. ✅ Unit tests: **21/21 passed** (validation, pure functions, calldata, approve, submitLeg flows)
10. ✅ Build + lint: **0 errors**

**Созданные файлы:**
- `apps/execution-orchestrator/src/execution/adapters/uniswap-v2.adapter.ts`
- `apps/execution-orchestrator/src/execution/adapters/uniswap-v2.adapter.spec.ts`

**Изменённые файлы:**
- `apps/execution-orchestrator/src/execution/execution.module.ts` (DI registration)
- `.cursor/plans/DEVELOPMENT_PLAN-DEX.md` (v1.6, 15/35)

**Поддерживаемые chains:** Arbitrum (42161), Base (8453), BNB (56)

**Принятые решения:**
1. `DexSwapParams` извлекается из `plan.playbookConfig.dexSwaps[legIndex]`
2. Slippage: `applySlippage()` — BigInt arithmetic `(expected * (10000 - bps)) / 10000`
3. `getSlippageBps()` — chain of: per-swap override → env `DEX_DEFAULT_SLIPPAGE_BPS` → default 50
4. `calculateAmountOutMin()` — public method, mockable in tests via `jest.spyOn`
5. Router addresses from `@arbibot/contracts-eth`: Arbitrum SushiSwapV2, Base SushiSwapV2, BNB PancakeV2

**Открытые вопросы:**
- Нет testnet fork интеграционного теста (требует RPC endpoint)
- Нет runbook для failed/stuck DEX transactions
- `/review-step` не пройден

**Следующие шаги:**
1. Пройти `/review-step` для DEX-1-1-ADAPTER-UNI2 → `done`
2. `DEX-1-1-ADAPTER-UNI3` — Uniswap V3 exactInput
3. `DEX-1-1-ADAPTER-SUSHI` — SushiSwap (shared utils с UniV2)
4. `DEX-1-1-VENUE-BIND` — VenueFactory по venue_key

---

### 2026-05-04 — AGENTS.md актуализация + CI lint fix (turbo.json) → done
**Статус:** done

**Задача:**
1. Проверить актуальность AGENTS.md, обновить расхождения
2. Исправить CI lint failure (canonical-market-service `no-redundant-type-constituents`)

**Выполнено:**
1. ✅ AGENTS.md обновлён (3 расхождения):
   - «10 шагов → done» → **«14/35 шагов → done»** (POOL-DISCOVERY, RISK-POLICIES, APPROVE-PATTERN, SLIPPAGE)
   - Добавлены CI fixes + review-step/skills update
   - Добавлены открытые вопросы (CI GitHub, недостающие тесты)
2. ✅ CI lint fix — корневая причина:
   - `turbo.json`: задача `lint` не имела `"dependsOn": ["^build"]`
   - Пакеты (`@arbibot/persistence`, `@arbibot/nest-database`) не собирались до lint
   - Типы резолвились как `any`/`error` → 4 ошибки `no-redundant-type-constituents`
   - **Фикс:** добавлено `"dependsOn": ["^build"]` для задачи `lint`

**Изменённые файлы:**
- `AGENTS.md` — 3 обновления (статус DEX, CI fixes, открытые вопросы)
- `turbo.json` — добавлена зависимость `"dependsOn": ["^build"]` для `lint`

**Верификация:**
- `npm run lint` — 28/28 ✅ (0 errors, warnings only)
- Git: clean, `main`, pushed to `origin`

**Git:**
- `5666649` — docs: update AGENTS.md
- `d26937e` — fix(ci): add ^build dependency to lint task in turbo.json

**Следующие шаги:**
1. Проверить CI зелёный на GitHub Actions (lint + build)
2. Продолжить `DEX-1-1-ADAPTER-UNI2` (критический путь)

---

### 2026-05-04 — git-workflow-agent skill + 4 CI fixes → done
**Статус:** done

**Задача:**
1. Создать Cursor skill для работы с Git (автоматические коммиты, исправление ошибок, корректное ведение Git)
2. Исправить 4 CI failure: `e2e-phase4-tier-routing`, `e2e-phase3-paper-discovery`, `e2e-phase2`, `build`

**Выполнено:**

#### 1. git-workflow-agent skill
- ✅ Создан `.cursor/skills/git-workflow-agent/SKILL.md` — 12 разделов:
  - Область действия, триггеры, форма коммита
  - Pre-commit проверки (lint → build → test)
  - Правила именования веток (`feat/`, `fix/`, `docs/`)
  - Разрешение конфликтов (abort/resolve протокол)
  - Recovery после неудачных операций
  - Windows path safety
  - Запрещённые операции (`push --force`, `reset --hard` на main)
- ✅ Зарегистрирован в `AGENTS.md` (пункт 4 в списке скиллов)
- ✅ Добавлен в `.cursor/commands/review-step.md` (таблица «Скиллы»)
- ✅ Добавлен в `.cursorrules` (Additional Resources → Skills)

#### 2. CI Fix: `032_dex_filters_seed.sql` (2 job'а)
- **Ошибка:** `column "scope" of relation "policy_configurations" does not exist`
- **Причина:** Миграция использовала неверные имена колонок (`scope` → `scope_type`, `environment` → нет, `tenant_id` → нет, `status` → `is_active`, `operator_id` → `updated_by`, `version` → `entity_version`)
- **Фикс:** Переписан INSERT по образцу `029_intake_policy_seed.sql` с idempotent `INSERT...SELECT...WHERE NOT EXISTS`
- **Затронутые CI job'ы:** `e2e-phase4-tier-routing`, `e2e-phase3-paper-discovery`

#### 3. CI Fix: `e2e-phase2` (PRIVATE_KEY_ENCRYPTION_KEY)
- **Ошибка:** `Error: PRIVATE_KEY_ENCRYPTION_KEY environment variable is required`
- **Причина:** `ExecutionModule` в `execution-orchestrator` импортирует `KeyVaultModule` (DEX), который требует env var
- **Фикс:** Добавлен dummy 64-hex default в `tools/ci-e2e-phase2.sh`: `PRIVATE_KEY_ENCRYPTION_KEY="${PRIVATE_KEY_ENCRYPTION_KEY:-aaaa...aaaa}"`
- Ключ валидный для `scryptSync`, не используется в Phase 2 тестах

#### 4. CI Fix: `build` (@arbibot/contracts-eth test)
- **Ошибка:** `@arbibot/contracts-eth#test exited (1)` — jest падает без spec-файлов
- **Причина:** Пакет имел `"test": "jest"` в package.json, но не имел `.spec.ts` файлов
- **Фикс:** Создан `packages/contracts-eth/src/index.spec.ts` — smoke test (ChainId enum, isMainnet/isTestnet, ABI exports) — 3/3 passed

**Изменённые файлы:**
- `.cursor/skills/git-workflow-agent/SKILL.md` (новый — 554 строки)
- `AGENTS.md` (пункт 4 в skills + workflow paragraph)
- `.cursor/commands/review-step.md` (таблица скиллов)
- `.cursorrules` (Additional Resources)
- `infra/postgres/migrations/032_dex_filters_seed.sql` (исправлены колонки)
- `tools/ci-e2e-phase2.sh` (добавлен PRIVATE_KEY_ENCRYPTION_KEY)
- `packages/contracts-eth/src/index.spec.ts` (новый smoke test)

**Git:**
- `2feb825` — feat(skills): add git-workflow-agent
- `3d2d68e` — fix(migrations): correct column names in 032
- `f6487eb` — fix(ci): add PRIVATE_KEY_ENCRYPTION_KEY for e2e-phase2
- `8e71880` — fix(contracts-eth): add smoke test for CI build
- Merge: `c7d9827`, `fbbc8fb` → `origin/main`

**Верификация:**
- `findstr` на `032_dex_filters_seed.sql` — только правильные колонки
- `npm run test -w @arbibot/contracts-eth` — 3 passed, 3 total ✅
- `git status` — clean, `main`, pushed to `origin`

**Следующие шаги:**
1. Проверить CI зелёный на GitHub Actions (все job'ы)
2. Продолжить `DEX-1-1-ADAPTER-UNI2` (критический путь)

---

### 2026-05-05 — Восстановление репозитория из OneDrive → done
**Статус:** done

**Задача:** Репозиторий перемещён из `C:\Users\kazak\Documents\Cursor\Arbibot 2` (OneDrive) в `C:\Coding\Arbibot-2`. OneDrive повредил `.git` каталог и создал дубликаты файлов с суффиксами `(2)`, `(3)` и т.д.

**Выполнено:**
1. ✅ `.git` пересоздан — `git init` + `fetch` + `checkout -f -b main origin/main` (чистый клон без истории OneDrive)
2. ✅ Удалено 28 файлов-дубликатов OneDrive: `AGENTS (2..4).md`, `session_summary (2..12).md`, `docs/progress (2..6).md`, `.cursor/plans/DEVELOPMENT_PLAN-DEX (2..10).md`, `packages/contracts-eth/tsconfig (2..10).json`
3. ✅ Fast-forward merge из `origin/fix/ci-contracts-eth-lint` — 2 коммита:
   - `dfb0cdb` — contracts(CI): fix lint error (tsconfig exclude)
   - `a7c6ef4` — feat(dex): DEX-1-1-ADAPTER-UNI2 UniswapV2Adapter
4. ✅ `npm ci` — 1271 пакетов
5. ✅ `npm run lint` — 28/28 ✅ (0 errors)
6. ✅ `npm run build` — 21/21 ✅
7. ✅ `git push origin main` — `509d391..a7c6ef4`

**Изменённые файлы:**
- `.git/` — полный пересоздание
- Удалено 28 файлов-дубликатов
- Merge принёс: `uniswap-v2.adapter.ts`, `uniswap-v2.adapter.spec.ts`, `execution.module.ts`, `contracts-eth/tsconfig.json`, `DEVELOPMENT_PLAN-DEX.md`, `AGENTS.md`, `progress.md`, `session_summary.md`

**Git:**
- HEAD: `a7c6ef4` — `main`, up to date с `origin/main`
- `git status` — clean

**Открытые вопросы:**
- CI зелёный на GitHub Actions не верифицирован
- `DEX-1-1-ADAPTER-UNI2` → `implemented`, awaiting `/review-step` → `done`
- Недостающие unit-тесты: `PoolDiscoveryService`, `RpcProviderManager`

**Следующие шаги:**
1. Проверить CI зелёный на GitHub Actions
2. Пройти `/review-step` для DEX-1-1-ADAPTER-UNI2 → `done`
3. `DEX-1-1-ADAPTER-UNI3` — Uniswap V3 exactInput

---

### 2026-05-05 (session 2) — DEX-1-1-ADAPTER-UNI3: UniswapV3Adapter → implemented
**Статус:** implemented (awaiting `/review-step` → `done`)

**Задача:**
1. Проанализировать состояние проекта, актуализировать AGENTS.md
2. Реализовать `DEX-1-1-ADAPTER-UNI3` — UniswapV3Adapter для `execution-orchestrator`

**Выполнено:**

#### 1. Анализ состояния проекта
- Прочитаны `docs/progress.md`, `session_summary.md`, `DEVELOPMENT_PLAN-DEX.md`
- Выявлена текущая позиция: DEX план 14/35 шагов done, UNI2 → `done`, следующий — UNI3
- AGENTS.md обновлён (3 расхождения):
  - `DEX-1-1-ADAPTER-UNI2` → `done`
  - Добавлен `DEX-1-1-ADAPTER-UNI3` → `implemented`
  - Обновлён счётчик: 15/35 шагов done

#### 2. UniswapV3Adapter (DEX-1-1-ADAPTER-UNI3)
- ✅ `UniswapV3Adapter` — реализация `VenueAdapter.submitLeg(plan, leg)` → `{ externalOrderId: txHash }`
- ✅ `exactInputSingle` calldata через `ethers.js Interface.encodeFunctionData` (function selector `04e45aaf`)
- ✅ Synchronous `calculateAmountOutMin` (slippage через `applySlippage`)
- ✅ `fee` default 3000, валидация uint24 range
- ✅ `sqrtPriceLimitX96` optional parameter
- ✅ Gas policy enforcement: reject при `withinPolicy: false`
- ✅ ERC20 approve integration: `ensureApproval()`
- ✅ Error hierarchy: `VenueSubmitClientError`, `VenueSubmitTransientError`, `VenueTerminalSubmitError`
- ✅ Prometheus metrics: `arb_dex_uniswap_v3_swap_total`, `arb_dex_uniswap_v3_swap_latency_seconds`
- ✅ DI: зарегистрирован в `ExecutionModule`
- ✅ Unit tests: **21/21 passed**
- ✅ Build: **0 errors**

**Созданные файлы:**
- `apps/execution-orchestrator/src/execution/adapters/uniswap-v3.adapter.ts`
- `apps/execution-orchestrator/src/execution/adapters/uniswap-v3.adapter.spec.ts`

**Изменённые файлы:**
- `apps/execution-orchestrator/src/execution/execution.module.ts` (DI registration)
- `AGENTS.md` (3 обновления)
- `.cursor/plans/DEVELOPMENT_PLAN-DEX.md` (UNI3 → implemented, review_notes)

**Принятые решения:**
1. `exactInputSingle` вместо `exactInput` (multi-hop) — single-pool MVP как в acceptance criteria
2. Shared utils с V2: `applySlippage`, `getSlippageBps`, `ensureApproval` (DRY)
3. `fee` parameter из `DexSwapParamsV3` (uint24 pool fee tier, default 3000 = 0.3%)
4. `sqrtPriceLimitX96` optional — 0 = no limit (standard pattern)
5. Function selector исправлен на корректный `04e45aaf` (`exactInputSingle(ExactInputSingleParams)`)

**Открытые вопросы:**
- Нет testnet fork интеграционного теста (требует RPC endpoint)
- Нет runbook для failed/stuck DEX transactions
- `/review-step` не пройдён

**Верификация:**
- Unit tests: 21/21 ✅
- Build execution-orchestrator: ✅
- Function selector: исправлен `414bf389` → `04e45aaf`

**Следующие шаги:**
1. Пройти `/review-step` для DEX-1-1-ADAPTER-UNI3 → `done`
2. `DEX-1-1-ADAPTER-SUSHI` — SushiSwap (shared utils с UniV2)
3. `DEX-1-1-VENUE-BIND` — VenueFactory по venue_key

---

### 2026-05-05 (session 3) — DEX-1-1-ADAPTER-UNI3 review + DEX-1-1-VENUE-BIND → implemented
**Статус:** implemented (awaiting `/review-step` для VENUE-BIND → `done`)

**Задача:**
1. Пройти `/review-step` для DEX-1-1-ADAPTER-UNI3 → `done`
2. Реализовать `DEX-1-1-VENUE-BIND` — VenueFactoryService

**Выполнено:**

#### 1. DEX-1-1-ADAPTER-UNI3 → `done` (review passed)
- ✅ Build monorepo: 21/21 ✅
- ✅ Unit tests: 21/21 ✅
- ✅ Commit: `a48c644`
- ✅ План обновлён: UNI3 → `done`, 16/35

#### 2. VenueFactoryService (DEX-1-1-VENUE-BIND) → `implemented`
- ✅ `VenueFactoryService` — фабрика адаптеров по venueKey
  - `extractVenueKey(plan, leg?)` — извлечение из playbookConfig (leg > plan)
  - `resolveAdapter(venueKey)` — роутинг: mock/http → legacy, uniswap-v2 → V2, uniswap-v3 → V3
  - `submitLeg(plan, leg)` — convenience: resolve + delegate
- ✅ Feature flag `DEX_VENUE_ENABLED` для DEX-адаптеров
- ✅ LegsModule DI: VenueFactoryService + все адаптеры (Mock, HTTP, UniV2, UniV3)
- ✅ ExecutionModule: экспортирует DEX-адаптеры для LegsModule
- ✅ Unit tests: **21/21 passed**
- ✅ Build: **21/21 ✅**

**Созданные файлы:**
- `apps/execution-orchestrator/src/execution/venue-factory.service.ts`
- `apps/execution-orchestrator/src/execution/venue-factory.service.spec.ts`

**Изменённые файлы:**
- `apps/execution-orchestrator/src/legs/legs.module.ts` (DI: VenueFactoryService + адаптеры)
- `apps/execution-orchestrator/src/execution/execution.module.ts` (exports DEX adapters)
- `.cursor/plans/DEVELOPMENT_PLAN-DEX.md` (VENUE-BIND → implemented, 16 done + 1 implemented)

**Принятые решения:**
1. `venueKey` извлекается из `plan.playbookConfig.venueKey` (plan-level) или `playbookConfig.legs[legIndex].venueKey` (leg-level override)
2. Unknown venueKey → `VenueSubmitClientError`
3. DEX adapters require `DEX_VENUE_ENABLED=true` env var
4. MockVenueAdapter и HttpVenueAdapter — legacy fallback (без флага)

**Открытые вопросы:**
- `/review-step` для VENUE-BIND не пройдён
- Нет `DEX-1-1-ADAPTER-SUSHI` (SushiSwap — следующий после review)
- Нет E2E теста с DEX venue routing
- CI зелёный на GitHub Actions не верифицирован

**Верификация:**
- Unit tests: 21/21 ✅ (extractVenueKey, resolveAdapter legacy/DEX/unknown, submitLeg)
- Build monorepo: 21/21 ✅

**Следующие шаги:**
1. Пройти `/review-step` для DEX-1-1-VENUE-BIND → `done`
2. `DEX-1-1-ADAPTER-SUSHI` — SushiSwap adapter
3. `DEX-1-2-FILL-TRACKING` — on-chain receipt → fill events
