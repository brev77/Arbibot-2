# Progress Arbibot 2

**Обновлено:** 2026-05-05

---

## Текущий статус

**DEX план:** 17/35 шагов → `done` (UNI2, UNI3, VENUE-BIND + все DEX-1.0)
**Текущий шаг:** `DEX-1-1-ADAPTER-SUSHI` → `implemented` (awaiting `/review-step`)
**Следующие:** `DEX-1-2-FILL-TRACKING`, `DEX-1-2-RECON-ONCHAIN`

**Build:** 21/21 ✅ | **Lint:** 28/28 ✅ | **SushiSwap tests:** 19/19 ✅

---

## Незавершённые задачи

### Высокий приоритет
1. **DEX-1-1-ADAPTER-SUSHI** → `implemented`, awaiting `/review-step` → `done`
2. **DEX-1-2:** `FILL-TRACKING`, `RECON-ONCHAIN`, `OUTBOX-EVENTS`
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

### 2026-05-05 — DEX-1-1-ADAPTER-SUSHI: SushiSwapV2Adapter → implemented
**Статус:** implemented (awaiting `/review-step`)

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
- `RpcProviderManager`, `GasEstimatorService`, `WalletManagerService`, `KeyVaultService` (20 tests)
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

**Дата:** 2026-05-05 22:00
**Задача:** DEX-1-1-ADAPTER-SUSHI — SushiSwap V2-style адаптер
**Статус:** `implemented` (awaiting `/review-step`)
**След. шаги:** `/review-step` → `done`, затем DEX-1-2-FILL-TRACKING

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

**Total migrations:** 001–033
**CI jobs:** build, lint, test, e2e-phase2, e2e-phase2-watchlist-route-scoring, e2e-phase3-paper-promotion, e2e-phase3-paper-discovery, e2e-phase4-tier-routing, bus-smoke
