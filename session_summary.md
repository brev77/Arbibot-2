# Session Summary

## 2026-05-04 — DEX-1-1-ADAPTER-UNI2: UniswapV2Adapter → implemented

**Дата:** 2026-05-04
**Фокус:** изменённые файлы, принятые решения, открытые вопросы

### Изменённые файлы

| Область | Файлы |
|--------|--------|
| **Новый адаптер** | `apps/execution-orchestrator/src/execution/adapters/uniswap-v2.adapter.ts` |
| **Unit-тесты** | `apps/execution-orchestrator/src/execution/adapters/uniswap-v2.adapter.spec.ts` |
| **DI** | `apps/execution-orchestrator/src/execution/execution.module.ts` |
| **DEX план** | `.cursor/plans/DEVELOPMENT_PLAN-DEX.md` (v1.6, 15/35) |
| **Документация** | `docs/progress.md` (append), `session_summary.md` (этот файл) |

### Принятые решения

1. **UniswapV2Adapter** реализует `VenueAdapter.submitLeg(plan, leg)` → `{ externalOrderId: txHash }`
2. **Calldata construction:** `ethers.js Interface.encodeFunctionData` для `swapExactTokensForTokens`
3. **ERC20 approve:** `ensureApproval()` — allowance check + approve при необходимости (через `TokenApproveService`)
4. **On-chain quote:** `calculateAmountOutMin()` через router `getAmountsOut` + slippage protection
5. **Gas policy:** reject при `withinPolicy: false` из `GasEstimatorService`
6. **Error hierarchy:** `VenueSubmitClientError` (validation), `VenueSubmitTransientError` (retryable), `VenueTerminalSubmitError` (reverted)
7. **Slippage:** `applySlippage()` — BigInt arithmetic; `getSlippageBps()` — per-swap override → env → default 50bps
8. **Router addresses:** из `@arbibot/contracts-eth` — Arbitrum SushiSwapV2, Base SushiSwapV2, BNB PancakeV2

### Верификация

- Unit tests: **21/21 passed** ✅
- Build: **21/21 green** ✅
- Lint: **0 errors** ✅ (warnings only)

### Открытые вопросы

- Нет testnet fork интеграционного теста (требует RPC endpoint)
- Нет runbook для failed/stuck DEX transactions
- `/review-step` не пройден → статус `implemented`, не `done`
- CI зелёный на GitHub Actions не верифицирован

### Следующие шаги

1. Пройти `/review-step` для DEX-1-1-ADAPTER-UNI2 → `done`
2. `DEX-1-1-ADAPTER-UNI3` — Uniswap V3 exactInput single pool
3. `DEX-1-1-ADAPTER-SUSHI` — SushiSwap (shared utils с UniV2)
4. `DEX-1-1-VENUE-BIND` — VenueFactory по venue_key

---

## 2026-05-04 — CI lint fix: contracts-eth tsconfig exclude → done

**Дата:** 2026-05-04
**Фокус:** изменённые файлы, принятые решения, открытые вопросы

### Изменённые файлы

| Область | Файлы |
|--------|--------|
| **CI fix (tsconfig)** | `packages/contracts-eth/tsconfig.json` (убран `"**/*.spec.ts"` из exclude) |
| **Документация** | `AGENTS.md` (упрощена секция Windows path), `docs/progress.md` (append), `session_summary.md` (этот файл) |

### Принятые решения

1. **Корневая причина CI failure:** `packages/contracts-eth/tsconfig.json` исключал `**/*.spec.ts` → ESLint glob `src/**/*.ts` находил `index.spec.ts`, но TypeScript Project Service не мог его обработать → `Parsing error: was not found by the project service`
2. **Фикс:** убран `"**/*.spec.ts"` из `exclude` — spec-файлы теперь включены в TS project, ESLint корректно их обрабатывает
3. **AGENTS.md:** упрощена секция Windows path — после переименования папки `Arbibot 2` → `Arbibot-2` советы про `subst`/junction больше не нужны

### Git

- Branch: `fix/ci-contracts-eth-lint`
- Commit: `dfb0cdb` — `contracts(CI): fix lint error by removing spec.ts exclusion from tsconfig`
- Pushed to `origin`, PR: https://github.com/brev77/Arbibot-2/pull/new/fix/ci-contracts-eth-lint

### Верификация

- `npm run lint` — 28/28 ✅ (0 errors)
- `npm run build` — 21/21 ✅
- `npm run test -w @arbibot/contracts-eth` — 3/3 ✅

### Открытые вопросы

- CI зелёный на GitHub Actions не верифицирован (фикс запушен в PR)
- Merge PR → main — pending

### Следующие шаги

1. Merge PR → main, проверить CI зелёный
2. Продолжить `DEX-1-1-ADAPTER-UNI2` (критический путь)

---

## 2026-05-04 — git-workflow-agent skill + 4 CI fixes → done

**Дата:** 2026-05-04
**Фокус:** изменённые файлы, принятые решения, открытые вопросы

### Изменённые файлы

| Область | Файлы |
|--------|--------|
| **Новый скилл** | `.cursor/skills/git-workflow-agent/SKILL.md` (554 строки — 12 разделов) |
| **Регистрация скилла** | `AGENTS.md`, `.cursor/commands/review-step.md`, `.cursorrules` |
| **CI fix (миграция)** | `infra/postgres/migrations/032_dex_filters_seed.sql` (переписан INSERT) |
| **CI fix (env var)** | `tools/ci-e2e-phase2.sh` (PRIVATE_KEY_ENCRYPTION_KEY) |
| **CI fix (test)** | `packages/contracts-eth/src/index.spec.ts` (новый smoke test) |
| **Документация** | `docs/progress.md` (append), `session_summary.md` (этот файл) |

### Принятые решения

1. **git-workflow-agent:** четвёртый Cursor skill — управляет всеми Git операциями (коммиты, ветки, конфликты, recovery). Триггеры: `git commit`, `git branch`, `conflict resolution`, `prepare PR`. Pre-commit: lint → build → test
2. **032_dex_filters_seed.sql:** переписан по образцу `029_intake_policy_seed.sql` — неверные колонки (`scope`, `environment`, `tenant_id`, `status`, `operator_id`, `version`) заменены на правильные из схемы 019+020
3. **PRIVATE_KEY_ENCRYPTION_KEY:** dummy 64-hex default в CI скрипте для execution-orchestrator — KeyVaultModule требует env var, но DEX-функционал не нужен в Phase 2 тестах
4. **@arbibot/contracts-eth test:** пакет имел `"test": "jest"` без spec-файлов → jest exit(1). Создан минимальный smoke test

### Git

- `2feb825` — feat(skills): add git-workflow-agent
- `3d2d68e` — fix(migrations): correct column names in 032
- `f6487eb` — fix(ci): add PRIVATE_KEY_ENCRYPTION_KEY for e2e-phase2
- `8e71880` — fix(contracts-eth): add smoke test for CI build
- Merge commits: `c7d9827`, `fbbc8fb` → `origin/main`

### Верификация

- `findstr` на `032_dex_filters_seed.sql` — только правильные колонки
- `npm run test -w @arbibot/contracts-eth` — 3/3 passed ✅
- `git status` — clean, `main`, pushed to `origin`

### Открытые вопросы

- CI зелёный на GitHub Actions не верифицирован (все 4 фиксa запушены)
- Недостающие unit-тесты: `PoolDiscoveryService`, `RpcProviderManager` (частично)

### Следующие шаги

1. Проверить CI зелёный на GitHub Actions (все job'ы)
2. Продолжить `DEX-1-1-ADAPTER-UNI2` (критический путь)

---

## 2026-05-04 — AGENTS.md актуализация + CI lint fix (turbo.json) → done

**Дата:** 2026-05-04
**Фокус:** изменённые файлы, принятые решения, открытые вопросы

### Изменённые файлы

| Область | Файлы |
|--------|--------|
| **Документация** | `AGENTS.md` (3 обновления), `docs/progress.md` (append), `session_summary.md` (этот файл) |
| **CI fix** | `turbo.json` (добавлен `"dependsOn": ["^build"]` для `lint`) |

### Принятые решения

1. **AGENTS.md актуализирован** по 3 расхождениям:
   - «10 шагов → done» → «14/35 шагов → done»
   - Добавлены CI fixes + review-step/skills update
   - Добавлены открытые вопросы (CI GitHub, недостающие тесты)
2. **CI lint fix — корневая причина найдена:** `turbo.json` задача `lint` не имела `"dependsOn": ["^build"]` → пакеты не собирались до lint → типы `any`/`error` → `no-redundant-type-constituents` ошибки
3. **Фикс:** добавлено `"dependsOn": ["^build"]` для задачи `lint` (как уже было для `build` и `test`)

### Верификация

- `npm run lint` — 28/28 ✅ (0 errors, warnings only)

### Git

- `5666649` — docs: update AGENTS.md
- `d26937e` — fix(ci): add ^build dependency to lint task in turbo.json

### Открытые вопросы

- CI зелёный на GitHub Actions не верифицирован
- Недостающие unit-тесты: `PoolDiscoveryService`, `RpcProviderManager` (частично)

### Следующие шаги

1. Проверить CI зелёный на GitHub Actions (lint + build)
2. Продолжить `DEX-1-1-ADAPTER-UNI2` (критический путь)

---

## 2026-04-30 (поздно вечером) — CI Fixes: 5 ошибок → green → done

**Дата:** 2026-04-30
**Фокус:** Исправление всех CI ошибок после пуша в main

### Исправленные ошибки (5 шт)

1. ✅ **ESLint: `publish-snapshot-updated.spec.ts`** — `jest.mocked()` вместо `as jest.MockedFunction`
2. ✅ **Build TS2307: `wallet-state.entity.ts`** → добавлен dep `@arbibot/contracts-eth` в persistence
3. ✅ **Docker `--health-cmd`** — кавычки в CI YAML (3 job'а)
4. ✅ **Bus-smoke** — добавлен `npm run build` перед скриптом
5. ✅ **ESLint: `capital.service.spec.ts`** — `no-redundant-type-constituents` → `Record<string, unknown>`

### Изменённые файлы

| Область | Файлы |
|--------|--------|
| **ESLint fix** | `packages/outbox-kafka-bridge/src/publish-snapshot-updated.spec.ts` |
| **Build fix** | `packages/persistence/package.json` |
| **CI YAML** | `.github/workflows/ci.yml` |
| **Lint fix** | `apps/capital-service/src/capital/capital.service.spec.ts` |
| **Документация** | `docs/progress.md` (append), `session_summary.md` (этот файл) |

### Git

- `6d80aa6` → fix 1-4
- `893032e` → fix 5
- Оба → `origin/main`

### Верификация

- `npm run lint` — 21/21 ✅
- `npm run build` — 21/21 ✅

### Следующие шаги

1. Проверить CI зелёный на GitHub Actions
2. Продолжить `DEX-1-1-ADAPTER-UNI2`

---

## 2026-04-30 (вечер) — Review-step orchestration + DEX skills update → done

**Дата:** 2026-04-30
**Фокус:** Реорганизация review-step команды и обновление Cursor-скиллов под DEX план

### Изменённые файлы

| Область | Файлы |
|--------|--------|
| **Review orchestration** | `.cursor/commands/review-step.md` (переписан) |
| **Architecture Guard** | `.cursor/skills/architecture-guard-agent/SKILL.md` (переписан) |
| **Backend Review** | `.cursor/skills/backend-review-agent/SKILL.md` (переписан) |
| **Frontend Review** | `.cursor/skills/frontend-review-agent/SKILL.md` (переписан) |
| **Документация** | `docs/progress.md` (append), `session_summary.md` (этот файл) |

### Принятые решения

1. **Приоритет планов в review-step:** `DEVELOPMENT_PLAN-DEX.md` (активный, по умолчанию) → `DEVELOPMENT_PLAN.md` (архивный, не редактировать без запроса)
2. **Архивный план защищён:** policy «не редактировать без явного запроса пользователя»
3. **Architecture Guard — всегда обязателен:** для любого шага без исключений (ранее — только для architecture review)
4. **DEX-specific checks:** добавлены в каждый скилл:
   - Architecture Guard: 12 инвариантов (EOA, AES-256-GCM, gas, on-chain entities, ethers.js, RPC, slippage, approve, paper/live)
   - Backend Review: 11 проверок (RpcProviderManager, GasEstimatorService, KeyVaultService, WalletManagerService, TokenApproveService, SlippageProtectionService, PoolDiscoveryService, DexRiskPolicyService, on-chain entities, env vars)
   - Frontend Review: 7 проверок (DEX filters panel, wallet UI, health banners, on-chain tx display, bridge status, ConfigService integration, query keys)
5. **Проверка `depends_on`:** перед ревью проверяются все зависимости

### Открытые вопросы

- Валидация нового review-step процесса на реальном DEX-шаге (например DEX-1-0-RPC)
- Недостающие unit-тесты: PoolDiscoveryService, RpcProviderManager (частично)
- `DEX-1-1-ADAPTER-UNI2` — следующий критический шаг

### Git

- `aae6d04` → `origin/main` (18 files, +1844/-103)

### Следующие шаги

1. Пройти `/review-step` для валидации нового процесса
2. Реализовать `DEX-1-1-ADAPTER-UNI2` (Uniswap V2 adapter)
3. Добавить недостающие unit-тесты

---

## 2026-04-30 — DEX-1.0 Execution Services Sprint → done

**Дата:** 2026-04-30
**Фокус:** Реализация всех DEX execution сервисов в `execution-orchestrator`

### Реализованные шаги DEX плана
- DEX-1-0-RPC: `RpcProviderManager` + `RpcHealthController` (failover, health, circuit breaker)
- DEX-1-0-VAULT: `KeyVaultService` (aes-256-gcm, 20 unit tests)
- DEX-1-0-WALLET-MGT: `WalletManagerService` (round-robin, balance checks)
- DEX-1-0-GAS: `GasEstimatorService` (EIP-1559, multi-strategy fallback)
- DEX-1-0-POOL-DISCOVERY: `PoolDiscoveryService` (UniV2/V3, cache с TTL)
- DEX-1-0-RISK-POLICIES: `DexRiskPolicyService` (slippage, position, protocol, volume)
- DEX-1-1-APPROVE-PATTERN: `TokenApproveService` (safe approve/revoke pattern)
- DEX-1-1-SLIPPAGE: `SlippageProtectionService` (constant product formula, max trade calc)

### Ключевые решения
1. **Safe approve pattern:** revoke→0 before set new allowance (USDT compatibility)
2. **Circuit breaker** для RPC провайдеров (5 ошибок за 60с, half-open через 30с)
3. **In-memory pool cache** с TTL (Redis-ready)
4. **Constant product formula** для slippage estimation
5. **`ExecutionModule`** — DI registration всех сервисов

### Новые метрики Prometheus
`arb_rpc_*`, `arb_gas_*`, `arb_wallet_*`, `arb_dex_pools_*`, `arb_dex_risk_*`, `arb_dex_token_*`, `arb_dex_slippage_*`

### Новые env vars
`POOL_DISCOVERY_ENABLED`, `POOL_CACHE_TTL_MS`, `DEX_MAX_SLIPPAGE_BPS`, `DEX_MAX_POSITION_SIZE_USD`, `DEX_MIN_POOL_LIQUIDITY_USD`

### Runbook
`docs/key-rotation-runbook.md` — процедура ротации wallet ключей

### Верификация
- `npm run build` → **21/21 green**
- Unit tests: rpc-provider-manager, wallet-manager, key-vault (20/20)

### Следующие шаги
1. Обновить миграции DEX-1-0-MIGRATIONS
2. Интеграция DexRiskPolicyService с config-service
3. E2E тест DEX execution flow

---

## 2026-04-29 (вечер) — DEX-1-0-TECH-CHOICE + DEX-1-0-ABIS → done

**Дата:** 2026-04-29
**Фокус:** изменённые файлы, принятые решения, открытые вопросы

### Изменённые файлы

| Область | Файлы |
|--------|--------|
| **Новый пакет** | `packages/contracts-eth/` (package.json, tsconfig.json, tsconfig.build.json, src/*) |
| **ABI** | `src/abis/uniswap-v2-router.ts`, `uniswap-v3-router.ts`, `sushiswap-router.ts`, `erc20.ts` |
| **Адреса** | `src/addresses/arbitrum.ts`, `base.ts`, `bnb.ts` |
| **Типы** | `src/types/chain-id.ts`, `address.ts` |
| **Экспорт** | `src/index.ts` |
| **DEX план** | `.cursor/plans/DEVELOPMENT_PLAN-DEX.md` (v1.1 — TECH-CHOICE + ABIS → done) |
| **Документация** | `docs/progress.md` (append) |

### Принятые решения

1. **ethers.js v6.13.0** — подтверждён как EVM library (уже установлен в nest-platform и execution-orchestrator)
2. **Отдельный пакет `@arbibot/contracts-eth`** — для ABI, адресов и chain-типов (не в `@arbibot/contracts`)
3. **Поддерживаемые сети:** Arbitrum (42161/421611), Base (8453/84532), BNB Chain (56/97) — mainnet + testnet
4. **DEX:** Uniswap V2, Uniswap V3, SushiSwap — полный ABI для router + ERC20
5. **BNB Chain:** PancakeSwap V2/V3 как основные DEX, Uniswap V3 и SushiSwap как дополнительные
6. **Address branded type:** `type Address = \`0x${string}\`` — type-safe без `any`

### Открытые вопросы

- `DEX-1-0-VAULT` / `DEX-1-0-WALLET-MGT` — код частично реализован, нужны метрики/health/runbook (после RPC+MIGRATIONS)
- `FE-SETTINGS-POLICY-WORKSPACE` → `implemented`, awaiting `/review-step`
- CI jobs на `main` не верифицированы

### Следующие шаги

1. `DEX-1-0-RPC` — RpcProviderManager (failover, health, метрики) — разблокирован
2. `DEX-1-0-MIGRATIONS` — таблицы DEX (on_chain_transactions, wallet_states, dex_pools, approvals) — разблокирован
3. Оба шага можно делать параллельно

### Верификация

- `npm run build` → **21/21 пакетов green**
- `npm run build -w @arbibot/contracts-eth` → success

---

## 2026-04-29 — AGENTS.md синхронизация и закрытие сессии

**Дата:** 2026-04-29

**Фокус:** изменённые файлы, принятые решения, открытые вопросы

### Изменённые файлы

| Область | Файлы |
|--------|--------|
| **Документация** | `AGENTS.md` (6 обновлений), `docs/progress.md` (append), `session_summary.md` (этот файл) |

### Принятые решения

1. **AGENTS.md актуализирован** по 6 расхождениям между реальным состоянием проекта и документацией:
   - Current status дата: `2026-04-21` → `2026-04-28`
   - Last major update: добавлены DEX Filters, DEX Code Review, FE-SETTINGS-POLICY-WORKSPACE, Phase 5 done
   - Known issues: DEX 3 блокера + FE-SETTINGS awaiting review
   - Новая секция «DEX Code Review & Filters (2026-04-28)»
   - FE-SETTINGS-POLICY-WORKSPACE (`implemented`) секция добавлена
   - Миграции 001–031 → 001–032 (2 места)
2. **Phase 5 подтверждён done** — все формальные шаги `P5-5-GW/OAPI/OCUI/BRIEF` → `done`
3. **Миграции** — подтверждены 001–032 (включая `032_dex_filters_seed.sql`)

### Открытые вопросы

- `FE-SETTINGS-POLICY-WORKSPACE` → `implemented`, awaiting `/review-step` → `done`
- DEX 3 критических блокера не исправлены (getEncryptedKey, DI, encryptionKey types)
- CI jobs на `main` не верифицированы

### Следующие шаги

1. Исправить 3 DEX блокера
2. Пройти `/review-step` для FE-SETTINGS-POLICY-WORKSPACE
3. Проверить CI jobs

---

## 2026-04-28 — Реализация DEX Opportunity Filters System (DEX-1-0-FILTERS)

**Дата:** 2026-04-28

**Фокус:** изменённые файлы, принятые решения, открытые вопросы

### Изменённые файлы

| Область | Файлы |
|--------|--------|
| **Backend (opportunity-service)** | `apps/opportunity-service/src/opportunities/dto/dex-filters-config.dto.ts`, `dto/preview-filters.dto.ts`, `opportunities.service.ts`, `opportunities.controller.ts` |
| **Contracts** | `packages/contracts/src/dex-filters.types.ts`, `index.ts` |
| **Frontend BFF** | `apps/web/app/api/operator/opportunities/preview-filters/route.ts`, `opportunities/metrics/dex-filters/route.ts`, `settings/configurations/dex.filters/route.ts` |
| **Frontend Lib** | `apps/web/lib/dex-filters-query-keys.ts`, `use-dex-filters.ts`, `api-base.ts` |
| **Frontend Components** | `apps/web/components/dex-filters/dex-filters-panel.tsx`, `ui/card.tsx`, `ui/switch.tsx`, `ui/badge.tsx`, `settings-workspace.tsx` |
| **Migrations** | `infra/postgres/migrations/032_dex_filters_seed.sql` |
| **Documentation** | `docs/dex-filters-config-keys.md`, `.cursor/plans/DEVELOPMENT_PLAN-DEX.md`, `docs/progress.md`, `session_summary.md` |

### Принятые решения

1. **Архитектура фильтрации:** все фильтры управляются через config-service с key `dex.filters` и поддерживают scope fallback (global → environment → tenant)
2. **Типы фильтров:** реализованы 4 типа фильтров с индивидуальным включением/выключением:
   - Threshold: minSpreadPct, minProfitUsd, maxFeesUsd
   - Volume: volumeRange (min/max)
   - Tokens: blacklistTokens, allowedChains, quoteAssets
   - Risk: highRisk (maxRiskLevel: low/medium/high)
3. **Preview functionality:** кнопка "Preview Impact" позволяет протестировать влияние фильтров без сохранения в конфиг
4. **Metrics:** эндпоинт `GET /opportunities/metrics/dex-filters` возвращает метрики за 24h (totalOpportunities, passedFilters, rejectedByFilters)
5. **SLO:** filter application latency < 10ms, preview impact < 100ms
6. **UI компоненты:** созданы недостающие UI компоненты (card, switch, badge) в стиле shadcn/ui
7. **React Query интеграция:** хуки `useDexFiltersConfig`, `useUpdateDexFiltersConfig`, `usePreviewDexFilters`, `useDexFiltersMetrics`
8. **TypeScript строгость:** все типы явно определены, используется `DexFiltersConfig` из `@arbibot/contracts`
9. **API-base:** добавлен экспорт `OPPORTUNITY_API_BASE` для BFF роутов

### Открытые вопросы

- Manual UI testing: `/settings` → "DEX filters" tab (требуется запуск dev сервера)
- Мониторинг эффективности фильтров на проде (reject rate, pass rate)
- Оптимизация порогов фильтрации на основе метрик
- Дополнительные фильтры по необходимости (например, MEV risk)

### Технические решения

1. **Backend DTOs:**
   - `DexFiltersConfigDto` — конфигурация фильтров с валидацией
   - `PreviewFiltersDto` — запрос для предпросмотра влияния фильтров
   - `DexFiltersPreviewResponse` — ответ с результатами предпросмотра

2. **Frontend Components:**
   - `DexFiltersPanel` — основной компонент с формой настройки фильтров
   - `FilterToggle` — компонент для threshold фильтров
   - `RangeFilter` — компонент для volume range фильтра
   - `TagFilter` — компонент для token фильтров (blacklist, chains, assets)
   - `RiskFilter` — компонент для risk фильтра с выбором уровня

3. **React Query Keys:**
   - `operatorKeys.dexFilters()` — ключ для конфигурации фильтров
   - `operatorKeys.dexFiltersPreview()` — ключ для предпросмотра
   - `operatorKeys.dexFiltersMetrics()` — ключ для метрик

4. **Миграция 032:**
   - Создаёт дефолтную конфигурацию для `dex.filters`
   - Включает все фильтры с разумными дефолтными значениями
   - Управляется через config-service

### Проверки качества

- Build: `npm run build -w @arbibot/web` — SUCCESS
- TypeScript: все типы корректны, без `any`
- Exports: `OPPORTUNITY_API_BASE` экспортирован из `api-base.ts`
- UI components: card, switch, badge реализованы в стиле shadcn/ui
- Integration: DexFiltersPanel интегрирован в settings-workspace.tsx

### Следующие шаги

1. Manual UI testing: запустить `npm run dev -w @arbibot/web` и проверить `/settings` → "DEX filters" tab
2. Мониторинг метрик эффективности фильтров на проде
3. Оптимизация порогов фильтрации на основе collected metrics
4. При необходимости: добавить дополнительные фильтры (MEV risk, liquidity score, etc.)

### Архитектурные инварианты

- ✅ Single-writer: opportunity-service является single-writer для фильтрации возможностей
- ✅ Config-service: используется для хранения конфигурации фильтров
- ✅ React Query: для управления состоянием и кэшированием
- ✅ TypeScript strict mode: все типы явно определены
- ✅ BFF pattern: все запросы проходят через BFF в `apps/web`

---

## 2026-04-27 — Закрытие сессии: анализ DEVELOPMENT_PLAN-DEX.md

**Дата:** 2026-04-27

**Задача:** Провести полный анализ `.cursor/plans/DEVELOPMENT_PLAN-DEX.md`, выявить пробелы и возможности улучшения.

**Статус:** done

**Реализовано:**
- Полный чтение файла (1489 строк) и проверка всех существующих разделов
- Подтверждение: DEX-1.3, DEX-1.4, DEX-2 существуют в плане (предыдущая ошибка исправлена)
- Выявление **6 реальных отсутствующих компонентов** (ранее было неверно):
  * Priority 1 (Critical): TX recovery (DEX-1.2-REC), Cost analysis (DEX-1.2-COST), Security review (DEX-1.2-SEC)
  * Priority 2 (High): Rollout plan (DEX-1.5-ROLL), Rate limiting (DEX-1.6-RATE)
  * Priority 3 (Medium): Testing strategy overview (DEX-TEST-OVERVIEW)
- Предоставлены детальные спецификации для каждого отсутствующего компонента
- Разработана методология самопроверки архитектурных планов

**Ключевые выводы:**
- План хорошо структурирован и включает основные компоненты DEX-исполнения
- Отсутствуют критичные для производства компоненты: восстановление транзакций, анализ затрат, security review
- План не содержит чёткой стратегии развёртывания (rollout plan)
- Нет комплексной стратегии тестирования
- Все компоненты совместимы с архитектурными принципами Arbibot 2 (single-writer, reservation-first)

**Принятые решения:**
1. **Не реализовывать изменения в файле плана** - задача была только в анализе и выявлении пробелов
2. **Ожидать продуктового решения** по 6 выявленным компонентам (какие из них добавить в план)
3. **Использовать разработанную методологию самопроверки** для будущих архитектурных планов

**Следующие шаги:**
- Продуктовое решение: какие из 6 выявленных компонентов добавить в DEVELOPMENT_PLAN-DEX.md
- При необходимости - реализация добавленных компонентов в коде
- Применение методологии самопроверки к другим планам в репозитории

**Изменённые файлы:** только чтение (`.cursor/plans/DEVELOPMENT_PLAN-DEX.md`, `docs/progress.md`, `session_summary.md`)

---

## 2026-04-27 — Анализ и улучшение DEVELOPMENT_PLAN-DEX.md

**Дата:** 2026-04-27

**Фокус:** Глубокий архитектурный анализ DEX-плана, выявление проблем, разработка методологии самопроверки, обновление плана с детализациями для MVP.

**Ключевые решения:**

1. **Методология самопроверки:** разработан чеклист для валидации архитектурных планов (полнота, реализуемость, соответствие принципам, приоритизация)
2. **Архитектурная совместимость:** все DEX-компоненты должны уважать single-writer и reservation-first паттерны Arbibot 2
3. **Приоритизация MVP:** фокус на минимальном наборе DEX-ов и базовых стратегиях
4. **Интеграция с OpenClaw:** DEX-мутации через gateway для аудита
5. **Мониторинг:** метрики и SLO для каждого DEX-компонента

**Открытые вопросы:**
- Конкретный список DEX-ов для MVP (продуктовое решение)
- Выбор между DEX-агрегатором и direct integration
- Стратегия ликвидности и управления slippage
- Минимальный объём для запуска

**Изменённые файлы:**
- `.cursor/plans/DEVELOPMENT_PLAN-DEX.md` — существенно обновлён с детализациями и улучшениями
- `docs/progress.md` — добавлена запись о сессии
- `session_summary.md` — добавлена запись о сессии

**Следующие шаги:** продуктовое подтверждение на DEX-ы, реализация Phase 0, CI/CD для DEX-компонентов, формальный architecture review.

---

## 2026-04-20 — Phase 4: `P4-4-SCORE` + `P4-4-CH` (100% шагов Phase 4)

**Дата:** 2026-04-20

**Фокус:** Runbook replay route scoring (`docs/route-scoring-replay.md`), `tools/replay-route-scoring-export.mjs` + `npm run replay:route-scoring-export`, ADR gate ClickHouse (`docs/adr-phase4-clickhouse-gate.md`), раздел analytics path latency в `docs/observability-tracing.md`; `DEVELOPMENT_PLAN.md` — оба шага → `done`; правки `AGENTS.md`, `phase4-prep-bridge.md`, `route-scoring-logic.md`, `package.json`, handoff в `docs/progress.md`.

**Открыто:** внедрение ClickHouse/DWH после срабатывания порогов ADR; опциональный compose-профиль analytics не добавлялся намеренно.

---

## 2026-04-21 — Закрытие сессии: `/compact` (после плана CI stability)

**Дата:** 2026-04-21

### /compact — Focus: изменённые файлы, принятые решения, открытые вопросы

**Изменённые файлы (область):**

| Область | Файлы |
|--------|--------|
| **Миграции** | `tools/verify-migrations-applied.mjs` (`--all`), корневой `package.json` (`db:verify-migrations:all`) |
| **Документация CI / ops** | `docs/operations/staging-migrations.md`, `docs/ci-verification-checklist.md`, `docs/grafana-dashboard-verification.md` (новый), `infra/grafana/README.md` |
| **HTTP venue** | `apps/execution-orchestrator/src/venue/http-venue.adapter.ts`, `http-venue.adapter.spec.ts`, `.env.example` |
| **OpenClaw** | `apps/openclaw-gateway/src/openclaw/safe-mode-metrics.ts`, `safe-mode.service.ts`, `docs/openclaw-safe-mode-runbook.md` |
| **Phase 4 prep** | `docs/phase4-prep-bridge.md` (SQL replay), `tools/lab-venue-stand.mjs` (ссылка на `venue-load-test`) |
| **Тесты / Jest** | `apps/config-service/tsconfig.spec.json`, `apps/config-service/package.json` (ts-jest → spec tsconfig), `apps/execution-orchestrator/src/legs/legs.service.spec.ts` (`playbookConfig`) |
| **Индекс** | `AGENTS.md`, `docs/TODO.md`, `docs/progress.md`, `session_summary.md` |

**Принятые решения:**

1. **Полная проверка миграций:** `verify-migrations-applied.mjs --all` сверяет все `*.sql` из репо с `schema_migrations`; дефолтный `db:verify-migrations` по-прежнему про **030/031**.
2. **CI checklist:** в `ci-verification-checklist.md` зафиксированы **7** параллельных jobs из `ci.yml` (не 8 — в workflow семь именованных job).
3. **Venue 4xx:** опциональный JSON в `VENUE_HTTP_ERROR_CATEGORY_MAP`; ключи `venueErrorCode` или `STATUS:venueErrorCode`; разрешение через `resolveVenueHttpClientCategory`, кэш сбрасывается `resetVenueHttpClientCategoryMapCache`.
4. **Safe mode Redis:** счётчик `arb_openclaw_safe_mode_redis_errors_total` (`connection` / `get` / `set`); ошибки записи enable/disable пробрасываются наверх после инкремента.
5. **config-service Jest:** `tsconfig.spec.json` extends `@arbibot/tsconfig/nest.json`, чтобы параметрные декораторы компилировались так же, как в `nest build`.

**Открытые вопросы:**

- Зелёный прогон всех jobs GitHub Actions на `main`/PR после пуша (локально `npm run lint` / `build` / `test` — успех после фиксов).
- На каждом окружении: `npm run db:migrate`, при необходимости `npm run db:verify-migrations:all`.
- Полный bus (`bus:publish` / `bus:consume` с seed) и `ci:bus-smoke` — при наличии Docker и корректного `DATABASE_URL` в том же shell (Windows: см. `docs/TODO.md`).
- Multi-replica OpenClaw: общий Redis по runbook; симуляция downtime Redis для алертов — вне автоматизированного прогона в этой сессии.

**Детали реализации:** см. append в [`docs/progress.md`](docs/progress.md) (блок 2026-04-21 — закрытие сессии).

---

## 2026-04-20 — CI stability plan (repo implementation)

**Фокус:** Закрытие пунктов плана «стабилизация CI и верификации (1 месяц)» в коде и документации: полная проверка миграций (`db:verify-migrations:all`), чеклисты CI/Grafana, `VENUE_HTTP_ERROR_CATEGORY_MAP`, метрики Redis safe mode OpenClaw, SQL replay в phase4-prep-bridge, исправление Jest config-service (decorators) и стаба `playbookConfig` в legs tests.

**Ключевые артефакты:** `tools/verify-migrations-applied.mjs --all`, `docs/ci-verification-checklist.md`, `docs/grafana-dashboard-verification.md`, `docs/phase4-prep-bridge.md` (SQL), `apps/openclaw-gateway` safe-mode metrics, `http-venue.adapter.ts` resolve mapping.

**Оператору:** применить миграции и `db:verify-migrations:all` на стендах; проверить GitHub Actions; bus-smoke / полный bus — по [`docs/outbox-inbox.md`](docs/outbox-inbox.md).

---

## 2026-04-21 — Production sprint: handoff (compact)

**Дата:** 2026-04-21

**Фокус:** Краткосрочный план производства — CI-паритет, миграции (verify), OpenClaw multi-instance (доки), bus seed (`seed:outbox-smoke-events:all`), smoke-consumer, HTTP venue 4xx, intake effective в `/settings`, формальный handoff review (`PRIO-P2-PROMO` / `PRIO-P2-RECAL` → `done`).

### Ключевые решения

1. **Локальная верификация = `lint` + `build` + `test`** из корня; правки под ESLint (`partial-fill-playbook`, удаление stray emit в `config-service/src`).
2. **Стенды:** после `db:migrate` — **`npm run db:verify-migrations`** (ожидаются **030** и **031** в `schema_migrations`); инструкции в `docs/operations/staging-migrations.md`.
3. **Multi-instance safe mode:** общий Redis (`REDIS_URL` / `OPENCLAW_SAFE_MODE_REDIS_URL`); чеклист в `docs/openclaw-safe-mode-runbook.md`.
4. **Bus:** `seed:outbox-smoke-events:all` вставляет все типы из allowlist bridge; consumer расширен логами `entityId` и `planId`/`legId` для leg/plan событий.
5. **HTTP venue:** ошибки 4xx несут **`meta`** (`category`, `venueErrorCode` из JSON) для наблюдаемости; тесты на 404 + `venueErrorCode`.
6. **Settings:** BFF **`GET /api/operator/settings/configurations/:configKey/effective`**; UI — только отображение effective JSON для `intake.throttling` и `intake.routing.tiers`.
7. **План:** `docs/review-handoff-2026-04-20.md` + перевод **`PRIO-P2-PROMO`** / **`PRIO-P2-RECAL`** в **`done`** в `DEVELOPMENT_PLAN.md`.

### Открыто на потом

- Зелёный CI на `main`/PR после пуша (все jobs из `ci.yml`).
- Реальное применение миграций и verify на каждом окружении.
- Полный ручной bus E2E на стенде с Docker/Redpanda при необходимости.

**Детали и перечень файлов:** см. блок «2026-04-21 — Закрытие сессии» в [`docs/progress.md`](docs/progress.md).

---

## 2026-04-21 — Закрытие сессии: compact + ключевые решения

**Дата:** 2026-04-21

### /compact — Focus: изменённые файлы, принятые решения, открытые вопросы

**Изменённые файлы:** см. блок «2026-04-21 — Закрытие сессии» в [`docs/progress.md`](docs/progress.md) (перечень путей и документов).

**Принятые решения (ключевые):**

- Закрытие позиции — только в **portfolio-service** (`quantity` → 0), audit + idempotency-таблица; gateway лишь проксирует.
- **Safe mode** — общий store через **Redis** при настроенном URL; иначе память процесса; async API статуса при чтении из Redis.
- **Качество promotion** — persisted поля + фоновый refresh для открытых кандидатов; API предпочитает persisted tier/score, если заданы.
- **Recalibration** — офлайн JSONL → агрегаты → proposed config fragments; применение только через config-service + approval.
- **OpenClaw UI** — позиции и close с двухшаговым подтверждением и `expectedEntityVersion` в теле POST.

**Открытые вопросы:** CI на PR/main после мержа; `db:migrate` 030/031 на стендах; Redis resilience; полный bus E2E.

**Следующие шаги:** как в [`docs/progress.md`](docs/progress.md) (секция 2026-04-21).

---

## 2026-04-20 — Краткосрочный план (1–2 недели): portfolio close, Redis safe mode, PRIO-P2-PROMO/RECAL

**Дата:** 2026-04-20

### /compact

- **Файлы:** `apps/portfolio-service` (`POST /positions/:id/close`, audit, idempotency), `infra/postgres/migrations/030_*.sql`, `031_*.sql`, `packages/persistence` (entity + close idempotency), `apps/openclaw-gateway` (`closePosition`, `SafeModeService` + `ioredis`, async `getState`, DTO `expectedEntityVersion` на базовом mutation DTO), `apps/paper-trading-service` (`PaperPromotionQualityWorker`, quality columns), `apps/web` (`openclaw-workspace` positions + close), `tools/recalibration/main.py`, `AGENTS.md`, `TODO.md`, `DEVELOPMENT_PLAN.md`, `docs/progress.md`, `openclaw-operator-api-spec.md`, `openclaw-safe-mode-runbook.md`, `.env.example`.
- **Решения:** close — quantity → 0 + audit; OpenClaw проксирует на portfolio; safe mode — Redis при `REDIS_URL` / `OPENCLAW_SAFE_MODE_REDIS_URL`; PRIO-P2-PROMO — persisted `quality_*` + worker; PRIO-P2-RECAL — JSONL → aggregates → proposed JSON.
- **Локально:** `npm run build` (persistence, openclaw-gateway, portfolio, paper, web); `npm run test -w @arbibot/openclaw-gateway`.
- **Открыто:** полный прогон `ci:e2e-phase4-tier-routing` / `ci:bus-smoke` с Docker на машине разработчика; `db:migrate` **030/031** на стендах.

---

## 2026-04-20 — Phase 5 OpenClaw: мутации, UI, bus seed + закрытие сессии

**Дата:** 2026-04-20

### /compact — Focus: изменённые файлы, принятые решения, открытые вопросы

**Изменённые файлы (область):** `apps/openclaw-gateway` (v0.2.0: `OpenclawMutationController`/`Service`, rate limit, `IncidentBriefsService`, `SafeModeService`, DTO, upstream `postJson`/`patchJson`, unit tests); `apps/web` (BFF `POST`/`PATCH` для `openclaw/v1`, `mergeOperatorIntoBody`, `OpenclawWorkspace`, `SafeModeBanner`, layout, query keys, типы); `packages/outbox-kafka-bridge` (`consume.ts` — предупреждение при неизвестном `eventName`); `execution-orchestrator` (`http-venue.adapter.ts` — уточнение таксономии 4xx); `tools/seed-outbox-events.mjs`, `venue-load-test.mjs`, `ci-bus-smoke.sh`; корневой `package.json`; документы (`ci-verification-checklist`, `e2e-scenarios`, `intake-degradation-runbook`, `openclaw-ui-design`, `openclaw-safe-mode-runbook`, правки spec/observability/AGENTS/TODO/DEVELOPMENT_PLAN/progress); `.env.example`.

**Принятые решения:**

1. **Мутации OpenClaw:** прокси к execution / reconciliation + audit; **BFF** — один catch-all `[[...path]]` для `POST`/`PATCH`, тело JSON с merge `operatorId` из сессии оператора.
2. **Close position:** **501 Not Implemented** до появления API в **portfolio-service**.
3. **Safe mode:** состояние в памяти процесса gateway + audit; баннер в operator layout и панель на `/openclaw`.
4. **Bus-smoke:** опционально `SEED_OUTBOX=1` + `DATABASE_URL` запускает `seed-outbox-events.mjs` в `ci-bus-smoke.sh`.
5. **`DEVELOPMENT_PLAN`:** `P5-5-OAPI`, `P5-5-OCUI`, `P5-5-BRIEF` → `done` (зафиксировано в плане).

**Открытые вопросы:** зелёный CI на `main`/PR после пуша; shared store для safe mode при N репликах; portfolio `close`; полный publish/consume с реальными `outbox_events` вне минимального CI.

**Следующие шаги:** следить за CI; при необходимости локально `ci:e2e-phase4-tier-routing` / `ci:bus-smoke`; продуктовый backlog — close position, распределённый safe mode, формальный review.

---

## 2026-04-20 — Phase 5 OpenClaw gateway + bus-smoke (Windows) + закрытие сессии

**Дата:** 2026-04-20

---

## /compact — Focus: изменённые файлы, принятые решения, открытые вопросы

### Изменённые файлы

| Область | Файлы |
|--------|--------|
| **openclaw-gateway** | `src/openclaw/openclaw-env.ts`, `openclaw-upstream.service.ts`, `openclaw-auth.guard.ts`, `openclaw-auth.guard.spec.ts`, `openclaw.controller.ts`, `openclaw.module.ts`; `src/app.module.ts`; `src/health/health.controller.ts`; `src/main.ts` (без логики, при необходимости); `package.json` (0.1.0, Jest); `README.md` |
| **apps/web** | `app/(operator)/openclaw/page.tsx`; `app/api/operator/openclaw/v1/[[...path]]/route.ts`; `lib/openclaw-bff.ts`, `lib/openclaw-types.ts`; `components/degraded-status-banner.tsx` (тип `ReactNode`, первая загрузка через `queueMicrotask`) |
| **Документация / конфиг** | `docs/openclaw-gateway-runbook.md`, `docs/openclaw-operator-api-spec.md`, `docs/TODO.md`, `docs/progress.md`, `AGENTS.md`, `.env.example`, `.cursor/plans/DEVELOPMENT_PLAN.md` (`P5-5-GW` → `done`) |
| **Инструменты** | `tools/ci-bus-smoke.sh` (комментарий Windows/WSL + PowerShell) |

### Принятые решения

1. **OpenClaw gateway (`P5-5-GW`):** только **read** к execution / portfolio / reconciliation и read-through к operator BFF `dashboard/summary`; аутентификация **`x-openclaw-api-key`** по списку **`OPENCLAW_API_KEYS`**; корреляция — форвард **`x-correlation-id`** в upstream `fetch`; пагинация планов — поверх списка execution (`limit`/`cursor`), upstream сам капает выборку.
2. **Web BFF:** **`GET /api/operator/openclaw/v1/*`** проксирует на gateway с серверными **`OPENCLAW_GATEWAY_URL`** и **`OPENCLAW_BFF_API_KEY`** (секрет не в браузере).
3. **`npm run ci:bus-smoke` на Windows:** скрипт идёт через **bash**; если это WSL без `docker.sock`, **docker compose** падает. Решение: **Docker Desktop WSL integration** или тот же порядок шагов из **PowerShell** (описано в `ci-bus-smoke.sh` и `docs/TODO.md`); локальный эквивалент smoke при поднятом Docker Desktop проверен из PowerShell (**успех**).
4. **DegradedStatusBanner:** возврат **`ReactNode`**, первая poller-загрузка через **`queueMicrotask`**, чтобы убрать предупреждение ESLint про setState в effect.

### Открытые вопросы

- Зелёный прогон всех CI jobs на **PR/main** после пуша (включая `e2e-phase4-tier-routing`, `bus-smoke`).
- Полный сценарий **bus:publish → consume** с реальными строками **`outbox_events`** — вне минимального `ci-bus-smoke`, по [`docs/outbox-inbox.md`](docs/outbox-inbox.md).
- **Phase 5 дальше:** `P5-5-OAPI` (мутации + approval), `P5-5-OCUI` (полноценный UI) — не в этой сессии.

### Следующие шаги

- Следить за CI на PR; при сбое bus-smoke — проверить окружение shell vs Docker (см. выше).
- Реализация **`P5-5-OAPI`** / расширение **`P5-5-OCUI`** по `.cursor/plans/DEVELOPMENT_PLAN.md`.

---

## 2026-04-21 — Краткосрочный план Phase 4 (seed, e2e, CI) + закрытие сессии

**Дата:** 2026-04-21

---

## /compact — Focus

### Изменённые файлы

| Область | Файлы |
|--------|--------|
| **Миграции** | `infra/postgres/migrations/029_intake_policy_seed.sql` |
| **Инструменты** | `tools/seed-intake-policy-config.mjs`, `tools/e2e-phase4-tier-routing.mjs`, `tools/ci-e2e-phase4-tier-routing.sh`, `tools/ci-bus-smoke.sh` |
| **Корень** | `package.json` (скрипты `e2e:phase4-tier-routing`, `ci:e2e-phase4-tier-routing`, `seed:intake-policy-config`, `ci:bus-smoke`) |
| **CI** | `.github/workflows/ci.yml` (jobs `e2e-phase4-tier-routing`, `bus-smoke`) |
| **Документация** | `docs/intake-policy-config-keys.md`, `docs/TODO.md`, `docs/progress.md`, `docs/phase2-risk-policy-roadmap.md`, `AGENTS.md`, `.cursor/plans/DEVELOPMENT_PLAN.md` (`P4-4-TIER`, `P4-4-UI`, шаг `P4-4-TIER-ROUTING-E2E`) |

### Принятые решения

1. **JSON intake** в БД и в коде согласованы с [`policy-types.ts`](apps/market-intake-service/src/policy/policy-types.ts): `intake.routing.tiers` — объекты `hot` / `warm` / `cold` с `enabled` + `instrumentKeys`, а не массив `tiers` из черновика плана.
2. **Сид:** миграция `029` даёт дефолты без audit; HTTP-скрипт `seed-intake-policy-config.mjs` — для стендов; в CI config-service стартует с **`AUDIT_CLIENT_ENABLED=false`**, чтобы POST/PUT не блокировались отсутствием audit.
3. **E2E Phase 4:** проверка `GET /health/degradation` по полям `fallbackMode` / `intakeThrottlingEnabled` (не `degraded`); warm tier — два ingest подряд → **429** + `throttled: true`.
4. **bus-smoke в CI:** сборка bridge + опциональный Docker `--profile bus`; полный `bus:publish`/`consume` с реальными строками `outbox_events` остаётся ручным/стендовым.

### Открытые вопросы

- Зелёный прогон jobs **`e2e-phase4-tier-routing`** и **`bus-smoke`** на `main`/PR после мержа.
- Полный end-to-end bus (`outbox_events` → Kafka) — по [`docs/outbox-inbox.md`](docs/outbox-inbox.md), вне минимального CI job.
- `PRIO-P2-PROMO` / `PRIO-P2-RECAL` / `P5-5-*` в `DEVELOPMENT_PLAN.md` — перевод статусов по формальному review, не в этой сессии.

### Следующие шаги

- Мониторинг CI; при сбое — логи `/tmp/arbibot-e2e-phase4-*.log` в `ci-e2e-phase4-tier-routing.sh`.
- Опционально: секция intake в `/settings` UI (если продуктово нужно отображать ключи поверх BFF).

---

## 2026-04-20 — Обновление документации (AGENTS.md, session_summary.md)

**Дата:** 2026-04-20

---

## /compact — Focus

### Изменённые файлы

|| Область | Файлы |
||--------|--------|
|| **Документация** | `AGENTS.md` (update), `session_summary.md` (этот файл) |

### Принятые решения

1. **AGENTS.md update:** добавлена информация о последней сессии (Phase 4 prep, BFF routes, CI, Frontend docs).
2. **session_summary.md update:** с сохранением истории предыдущей сессии (Phase 4 prep implementation).

### Открытые вопросы

- Нет открытых вопросов в рамках обновления документации.

### Следующие шаги

- По запросу пользователя: начать работу над задачами из TODO.md / DEVELOPMENT_PLAN.md.
- При необходимости: обновить `DEVELOPMENT_PLAN.md` для `PRIO-P2-PROMO`, `PRIO-P2-RECAL`, `P5-5-GW`, `P5-5-OAPI`.

---

# Session Summary: Phase 4 prep — CI, observability, docs

**Дата:** 2026-04-20

---

## /compact — Focus

### Изменённые файлы

|| Область | Файлы |
||--------|--------|
|| **CI / E2E** | `tools/ci-e2e-phase2-watchlist-route-scoring.sh` (new); [`package.json`](package.json) (`ci:e2e-phase2-watchlist-route-scoring`, `export:route-scoring-history`); [`.github/workflows/ci.yml`](.github/workflows/ci.yml) (job `e2e-phase2-watchlist-route-scoring`) |
|| **`apps/web`** | [`app/api/operator/settings/watchlist-tiers/route.ts`](apps/web/app/api/operator/settings/watchlist-tiers/route.ts); [`components/settings-workspace.tsx`](apps/web/components/settings-workspace.tsx) (блок watchlist tiers + парсинг `{ items }` для route scoring) |
|| **Grafana** | [`infra/grafana/dashboards/arbibot-risk-policy-writers.json`](infra/grafana/dashboards/arbibot-risk-policy-writers.json); [`infra/grafana/README.md`](infra/grafana/README.md) |
|| **Инструменты** | [`tools/export-route-scoring-history.mjs`](tools/export-route-scoring-history.mjs) |
|| **Документация** | [`docs/phase4-prep-bridge.md`](docs/phase4-prep-bridge.md), [`docs/adr-phase4-intake-throttling.md`](docs/adr-phase4-intake-throttling.md), [`docs/phase4-ui-degraded-signals.md`](docs/phase4-ui-degraded-signals.md); правки [`docs/phase2-risk-policy-roadmap.md`](docs/phase2-risk-policy-roadmap.md), [`docs/TODO.md`](docs/TODO.md), [`AGENTS.md`](AGENTS.md); append [`docs/progress.md`](docs/progress.md), этот файл |

### Принятые решения

1. **CI вместо только ручного gate:** добавлен отдельный job и bash-wrapper по аналогии с `ci-e2e-phase3` — только Postgres + **risk-service** + токен `RISK_POLICY_JOB_TRIGGER_TOKEN` (дефолт в скрипте для CI).
2. **Операторская видимость tiers:** read-only через существующий risk API — BFF прокси без дублирования логики в других сервисах; таблица на `/settings` рядом с route scoring history.
3. **Grafana:** один JSON-дашборд в репо с rates счётчиков writers и quantiles по `arb_route_scoring_score_distribution_bucket`.
4. **Replay без CH:** экспорт `route_scoring_history` в stdout (JSONL/CSV), параметры периода и опционально `ROUTE_KEY` через env.
5. **Phase 4 границы:** single-writer таблиц — **risk-service**; intake в ADR — только read/cache политики, fallback при сбое risk/config.

### Открытые вопросы

- **Локальный полный E2E bash-цикл** на машине без Docker Postgres в этой сессии не прогонялся; валидация — CI job + локальные lint/test web/risk/contracts.
- **Migration 020 / full bus-smoke** — вне скоупа; остаются в [`docs/TODO.md`](docs/TODO.md).

### Следующие шаги

- Убедиться, что job **`e2e-phase2-watchlist-route-scoring`** зелёный на `main`/PR.
- По продукту: реализация throttling в **market-intake** по ADR; опционально BFF «health policy writers» для UI без Grafana.

---

# Session Summary: Phase 2.2 writers — quality gate & handoff

**Дата:** 2026-04-19

---

## /compact — Focus

### Изменённые файлы

|| Область | Файлы |
||--------|--------|
|| **Тесты (`@arbibot/risk-service`)** | `apps/risk-service/src/policy/watchlist-tiering-writer.service.spec.ts`, `route-scoring-writer.service.spec.ts`, `policy-jobs.service.spec.ts` |
|| **E2E** | `tools/e2e-phase2-watchlist-route-scoring.mjs` |
|| **Документация** | `docs/progress.md` (append), `docs/TODO.md` (строка актуализации), `session_summary.md` (этот файл) |

### Принятые решения

1. **`@typescript-eslint/unbound-method` в Jest:** не передавать в `expect(...)` методы сомокастных объектов (`watchlist.recordSnapshot`, `scoring.append`, `audit.record`, `watchlistWriter.runCycle`). Вместо этого — локальные `const fn = jest.fn()`, внедрение в мок-объект и ассерты на `fn`.
2. **E2E-скрипт:** финальный `console.log` без `eslint-disable` — скрипт не в eslint scope пакета risk-service, комментарий был лишним.
3. **Верификация перед handoff:** `npm run lint -w @arbibot/risk-service`, полный `npm run test -w @arbibot/risk-service`, `npm run build -w @arbibot/contracts` — все успешны.

### Открытые вопросы

- **E2E Phase 2.2:** в этой сессии не запускался полный `npm run e2e:phase2-watchlist-route-scoring` против живого стека (нужны `DATABASE_URL`, поднятый risk-service, согласованный `RISK_POLICY_JOB_TRIGGER_TOKEN` на клиенте и сервере).
- **CI:** нет обязательной job в pipeline для нового E2E (по плану — опционально).
- **Migration 020:** по-прежнему отдельный backlog (`020_policy_configuration_scopes.sql`).

### Следующие шаги

- Прогнать E2E локально или в CI-обёртке при готовности инфраструктуры.
- Продолжить Phase 4 / roadmap по аналитике tiers и scores приоритетами продукта.

---

# Session Summary: AGENTS.md update + bus-smoke verification

**Дата:** 2026-04-19

---

## /compact — Focus

### Изменённые файлы

|| Область | Файлы |
||--------|--------|
|| **документация** | `AGENTS.md` (update), `docs/progress.md` (append), `session_summary.md` (этот файл) |
|| **outbox-kafka-bridge** | сборка для runtime verification |

### Принятые решения

1. **AGENTS.md update:** добавлена информация о последней сессии (review gate закрыт, Monorepo ESLint исправлен, bug fix в `PaperDiscoveryService.runDiscoveryCycle`, worker improvements)
2. **Bus-smoke — static verification:** код `outbox-kafka-bridge` проверен на соответствие документации в `docs/outbox-inbox.md` (entrypoints, event_type filter, smoke-consumer logging)
3. **Bus-smoke — runtime verification:** запущен Redpanda (порт 19092), publisher и consumer успешно подключены к Kafka
4. **Full E2E отложен:** для полной проверки с сообщениями в топике требуются запущенные сервисы с сгенерированными outbox_events (future task, connection test достаточен)

**Проверки качества:**
- Lint: SUCCESS — AGENTS.md и progress.md без ошибок
- Build: SUCCESS — outbox-kafka-bridge собран
- Docker compose: SUCCESS — Redpanda запущен и остановлен
- Runtime: SUCCESS — publisher и consumer подключены к Kafka

### Открытые вопросы

- **Migration 020:** SQL ошибки в `020_policy_configuration_scopes.sql` (не связанный с bus-smoke, отдельный issue для будущего fix)
- **Full E2E bus-smoke:** при изменениях в outbox-kafka-bridge или event types требуется full end-to-end проверка с запущенными сервисами

### Следующие шаги

- При необходимости — запустить full bus-smoke (docker compose + сервисы + E2E + publisher + consumer)
- При необходимости — fix migration 020 (отдельная задача)
- Продолжить backlog по Phase 2.2 / operator API по плану

---

# Session Summary: Phase 2.2 slice, миграции, `db:migrate`, артефакты

**Дата:** 2026-04-19

---

## /compact — Focus

### Изменённые файлы (ключевые):**
- `infra/postgres/migrations/020_policy_configuration_scopes.sql`, `024_fix_rollback_configuration_function.sql`, `028_paper_drift_route_key.sql`
- `apps/config-service/src/config/configurations.service.ts` (вызов `rollback_configuration`)
- `apps/paper-trading-service/src/paper/paper.module.ts`, `paper-drift.service.ts`, `dto/create-drift-sample.dto.ts`, `packages/persistence/src/paper-drift-sample.entity.ts`
- `apps/risk-service/package.json` (jest из корневого `node_modules` на Windows)
- `apps/web/app/api/operator/settings/route-scoring/[routeKey]/route.ts`, `apps/web/components/settings-workspace.tsx`
- `docs/observability-tracing.md`, `docs/paper-promotion-criteria.md`, `docs/services.md`, `AGENTS.md`, `docs/TODO.md`, `.cursor/plans/DEVELOPMENT_PLAN.md`, `docs/progress.md`

**Принятые решения:**
1. **`020` идемпотентность:** `CREATE TYPE` в `DO … EXCEPTION WHEN duplicate_object`; смена уникальности — `ALTER TABLE … DROP CONSTRAINT IF EXISTS policy_configurations_key_version_unique` затем `DROP INDEX IF EXISTS`, затем `CREATE UNIQUE INDEX IF NOT EXISTS …`.
2. **`rollback_configuration`:** в PostgreSQL нельзя оставлять обязательный параметр после параметров с `DEFAULT` — порядок: `(p_config_key, p_to_version, p_operator_id, p_scope_type DEFAULT …, p_scope_value DEFAULT …)`; вызов из сервиса: `[configKey, toVersion, operatorId, scopeType, scopeValue]`.
3. **`028` и дрифт:** колонка `route_key` в `paper_drift_samples` + опциональное поле в DTO; импорты discovery из `src/paper-discovery/` через `../paper-discovery/`.
4. **`db:migrate`:** локально подтверждены запись `028_paper_drift_route_key.sql` в `schema_migrations` и наличие `route_key` в таблице.
5. **Тесты risk-service:** скрипт `node ../../node_modules/jest/bin/jest.js`, если локальный `node_modules/jest` отсутствует.

**Открытые вопросы:**
- Прогон миграций и проверка `028` на **вашем** staging (нужен свой `DATABASE_URL`).
- Заполнение watchlist / route scoring — пока read API и таблицы; writer-пайплайн в backlog (`docs/TODO.md`).
- Сопоставление idempotency adaptive risk со строкой `reasons` — при смене текста префикса возможна хрупкость (улучшение: явный флаг в схеме хранения).

**Следующие шаги:** `npm run db:migrate` на staging; SQL-проверка `schema_migrations` + `information_schema.columns` для `route_key`; приоритизация writer jobs для tier/score; при необходимости полный `lint`/`build` монорепо.