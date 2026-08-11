# DEVELOPMENT_PLAN10 — Live auto-execution (single-chain)

> **Scope:** закрыть архитектурный gap между `risk_checked` opportunities и
> live-execution. Сегодня opportunity «зависает» в `risk_checked` (терминальное
> состояние) — никто автоматически не создаёт execution plan. PLAN10 вводит
> гибридную авто-торговлю: opp-service находит/запускает план, EO выполняет его
> локальным драйвером, feedback через HTTP callback.
>
> **Предшественник:** PLAN9 (single-chain Arbitrum live-readiness) закрыл кодовые
> блокеры execution-пути (broadcast idempotency, on-chain tx persist, nonce lock,
> slippage gate). PLAN10 строится поверх PLAN9.
>
> **Cross-chain (мосты) → вне scope.** Scanner opportunities single-chain; bridge
> venue keys захолтены до отдельного плана.

---

## Сводка шагов

| step_id | Вектор | gate | Тип | impact/effort | status |
|---------|--------|------|-----|---------------|--------|
| `P10-1-LIVE-AUTO-CONFIG` | FUNC (SEC) | live-blocker | пробел | 4/1 (XS) | `done` (787fc38) |
| `P10-2-LIVE-KILL-SWITCH-READ` | SEC (FUNC) | live-blocker | пробел | 4/2 (S) | `done` (787fc38) |
| `P10-3-TOKEN-RESOLVER` | FUNC (SEC) | live-blocker | пробел | 4/3 (M) | `done` (787fc38) |
| `P10-4-LIVE-PLAN-SETUP` | FUNC (SEC) | live-blocker | пробел | 4/3 (M) | `done` (787fc38) |
| `P10-5-LIVE-AUTO-DRIVE` | FUNC (SEC) | live-blocker | пробел | 5/3 (M) | `done` (787fc38) |
| `P10-EO-LEG-AUTO-DRIVER` | REL (SEC) | live-blocker | пробел | 5/4 (L) | `done` (787fc38) |
| `P10-FB-LIVE-COMPLETION-CALLBACK` | REL (ARCH) | live-blocker | пробел | 3/2 (S) | `done` (787fc38) |
| `P10-AMT-NOTIONAL-TO-AMOUNTIN` | FUNC (SEC) | paper-check | пробел | 3/2 (S) | `in-progress` (787fc38 — DTO поле добавлено; runtime конверсия = Phase 2, pre-quoted path покрывает MVP) |
| `P10-6-MIGRATIONS` | DEVOPS (SEC) | live-blocker | ops | 3/1 (XS) | `done` (787fc38 — migrations 053/054) |
| `P10-7-PANIC-SCRIPTS` | DEVOPS (SEC) | live-blocker | ops | 3/1 (XS) | `done` (787fc38 — `tools/panic-button.sh` flips `LIVE_AUTO_DRIVE_ENABLED`+`LEG_AUTO_DRIVE_ENABLED`) |
| `P10-8-TARGETED-TESTS` | TEST (SEC) | live-blocker | тест | 4/3 (M) | `done` (787fc38 — 4 spec-файла: leg-auto-driver, live-auto-drive-config, live-auto-drive.worker, plan-setup-orchestrator) |
| `P10-9-LIVE-SMOKE` | REL (DEVOPS) | live-blocker | тест | 3/2 (S) | `proposed` ⏸ — dedicated live-auto-drive smoke не создан; переиспользуется PLAN8 `smoke:live-testnet` (общий DoD Gate 3) |

> P10-6 (migrations) и P10-7 (panic-scripts) — операционные шаги, в реестр
> инициатив `roadmap-vectors.md` не вносятся (по P5: реестр не дублирует
> операционный трекер). Кодовые инициативы `#35–#44` см. в §«Маппинг».

---

## Аудит кода 2026-08-04 — основа плана

### Корневой gap

`apps/opportunity-service/src/opportunities/auto-drive.worker.ts:87-93` — после
risk approved AutoDriveWorker (opportunity-service) вызывает `paperEnqueue()` и
**идёт только в paper path**. На execution-планы — ноль вызовов.

State machine (`opportunity-states.ts`): `detected → enriched → risk_checked`.
`risk_checked` — терминальное состояние; дальше opportunity никуда не переходят,
только кормят paper-promotion. Для live их должен кто-то «забрать».

### Факты о существующей live-цепочке

- `POST /execution/plans/multi-leg` (`plans.controller.ts:61`) и
  `POST /execution/plans/:planId/begin-execution` (`plan-execution.controller.ts:16`)
  **никем не вызываются автоматически**. Потребители: operator UI (ручной клик),
  Hermes MCP (`arm_plan`/`execute_plan`).
- `beginExecution` создаёт legs в `created` и возвращает управление. **Legs остаются
  в `created` навсегда**, если внешний клиент не вызовет mark-sent. Внутри EO
  НЕТ LegDriverWorker; stuck-plan-reaper берёт только `submitting`.

### Архитектурное решение: гибрид

| Сервис | Зона ответственности |
|---|---|
| opportunity-service | находит, создаёт и *запускает* план (setup-only saga, 5 шагов) |
| execution-orchestrator | *выполняет* план до конца (новый локальный DI-драйвер legs) |
| opportunity-service (HTTP) | получает feedback о завершении через callback endpoint |

Разделение: HTTP-сага из 11 вызовов unreliable, on-chain broadcast должен жить в EO
рядом с кошельком/RPC. Setup (create→reserve→link→arm→begin) — в opp-service;
per-leg lifecycle (mark-sent→ack→fill) — в EO.

---

## Фидбек Гермеса (2 раунда) и фактчек

Полный разбор в истории сессии. Краткое резюме принятых правок:

| # | Замечание Гермеса | Вердикт после проверки | Покрытие |
|---|---|---|---|
| Р1-2 | Per-leg lifecycle оставить в EO («уже умеет») | ⚠️ Факт «уже есть» неверен — EO не драйвит `created`. Но принцип прав | P10-EO (новый driver) |
| Р1-4 | Worker должен резолвить wallet | ❌ `recipient` опционален, `WalletManager.selectWallet` резолвит сам (`uniswap-v2.adapter.ts:573`) | — (не нужно) |
| Р1-5 | amountIn: sell = buy fill output (CRITICAL) | ⚠️ Runtime chaining отсутствует. Принята Модель #1 (pre-quoted) для MVP | P10-3, P10-4 |
| Р1-6 | Outbox — cross-service read (race) | ❌ **Ошибка** — таблица одна, race нет | P10-FB |
| Р2-1 | markAcknowledged после submitting | ✅ Подтверждено: leg остаётся `submitting`, markAcknowledged бросает Conflict | P10-EO state-check |
| Р2-2 | PriceOracle не в builder | ✅ Подтверждено — конверсия в `beginExecution` (costEstimator уже там) | P10-AMT |
| Р2-3 | Concurrent legs = nonce гонка | ✅ Принято — sequential обработка | P10-EO |
| Р2-4 | Paper legs фильтр | ✅ `isLiveVenueKey` filter | P10-EO |
| Р2-5 | Sell amountIn = buy fill | ✅ (см. Р1-5) — Модель #1 pre-quoted + recovery | P10-3, P10-8 |
| Р2-6 | Outbox processed_at race | ✅ **Подтверждено** — `processed_at` общая, пересекающиеся allowlist создают race | P10-FB (HTTP callback) |

---

## Out of scope (явно отложено)

- **Cross-chain (мосты):** scanner opportunities single-chain; bridge venue keys
  захолтены до отдельного плана.
- **Long-tail tokens:** TokenResolver работает только для WETH/USDC/USDT (staples).
  Для других — fail-closed skip. Расширение canonical_instruments → отдельная задача.
- **UniV3 fee-tier:** Phase 2 (MVP на UniV2, fee-tier не нужен).
- **Scanner bug token=quoteAsset:** отдельная задача. TokenResolver обходит, работая
  из `instrumentKey` (адреса там корректны), а не из payload.
- **Dedicated UI:** generic config-service BFF достаточно; сначала убрать мёртвые
  `requireTwoPersonApproval` тумблеры.
- **Новые Hermes tools:** `arm_plan`/`execute_plan` уже существуют для ручного path.
- **Предсуществующий race settlement-relay vs kafka-bridge** по
  `legFilled`/`planCompleted` (комментарий `publish-snapshot-updated.ts:28-30`
  устарел после P9-8). Зафиксирован, отдельная задача — вне scope PLAN10.

---

## P10-1 — LiveAutoDriveConfigService + constants (opp-service)

- **step_id:** `P10-1-LIVE-AUTO-CONFIG`
- **Вектор:** FUNC (SEC)
- **gate:** live-blocker

**Риск:** автономный live-worker требует kill-switch, иначе бот отправляет реальные
деньги без явного opt-in оператора. Безопасность капитала.

**Реализация:** клон `paper-trading-service/.../auto-drive-config.service.ts` с
namespace `live.auto_drive`. `LIVE_AUTO_DRIVE_POLICY_KEY='live.auto_drive'`.

**Поля** (env/default/min): `enabled`(LIVE_AUTO_DRIVE_ENABLED/false), `intervalMs`
(LIVE_AUTO_DRIVE_INTERVAL_MS/10000/min1000), `minNetProfitUsd`
(LIVE_AUTO_DRIVE_MIN_NET_PROFIT_USD/5), `maxConcurrentPlans`
(LIVE_AUTO_DRIVE_MAX_CONCURRENT_PLANS/3), `notionalUsd`(LIVE_NOTIONAL_USD/50),
`batchSize`(LIVE_AUTO_DRIVE_BATCH_SIZE/1/min1). Remote-overridable subset:
enabled/minNetProfitUsd/maxConcurrentPlans/notionalUsd. TTL 15s
(`LIVE_AUTO_DRIVE_CONFIG_CACHE_MS`, min 5000), signedFetch→
`/policy/configurations/live.auto_drive/effective`, env baseline + type-safe merge,
never-throws fallback.

**Файлы:**
- `apps/opportunity-service/src/opportunities/live-auto-drive-config.constants.ts`
- `apps/opportunity-service/src/opportunities/live-auto-drive-config.service.ts`
- `apps/opportunity-service/src/opportunities/live-auto-drive-config.service.spec.ts`

**DoD:** spec — env parse, merge с remote, cache TTL, fetch-failure→env, isEnabled().

- **depends_on:** —
- **status:** `proposed`

---

## P10-2 — LiveKillSwitchService (opp-service)

- **step_id:** `P10-2-LIVE-KILL-SWITCH-READ`
- **Вектор:** SEC (FUNC)
- **gate:** live-blocker

**Риск:** opp-service не имеет доступа к `DexKillSwitchService` (он в EO module).
Worker должен проверять halt-state перед созданием плана, иначе kill-switch
оператора игнорируется при auto-trade.

**Реализация:** структура клон `capital-limits.service.ts` (lazy, ServiceUnavailable-
style), **семантика `dex-kill-switch.service.ts` 1-в-1** (env full-override — оба
сервиса соглашаются по halt-состоянию):

- `DEX_LIVE_KILL_SWITCH` env: `'true'|'1'`→halt, `'false'|'0'`→allow, unset→defer
- cached `dex.limits.killSwitch` (TTL 30s)
- fail-closed: `NODE_ENV === 'production'` → halt (return true); non-prod → allow

**API:** `isLiveHalted(): Promise<boolean>`, `assertLiveNotHalted(): Promise<void>`
(throws Conflict если halted), `refresh(): Promise<void>`.
signedFetch `${CONFIG}/policy/configurations/dex.limits/effective` → `.killSwitch`.

**Файлы:**
- `apps/opportunity-service/src/opportunities/live-kill-switch.service.ts`
- `apps/opportunity-service/src/opportunities/live-kill-switch.service.spec.ts`

**DoD:** spec — env ветки (`true`/`1`/`false`/`0`/unset), config cache, prod
fail-closed, non-prod allow.

- **depends_on:** —
- **status:** `proposed`

---

## P10-3 — TokenResolverService + amountIn calc (opp-service)

- **step_id:** `P10-3-TOKEN-RESOLVER`
- **Вектор:** FUNC (SEC)
- **gate:** live-blocker

**Риск:** scanner payload содержит `token = quoteAsset = USDC` (баг сканера) и НЕ
содержит `amountIn`. Без enrichment plan создастся, но упадёт на markSent.

**Реализация:**

`resolveTokens(instrumentKey) → {token0Address, token1Address, decimals0,
decimals1, chainId}|null`. **Работает ТОЛЬКО из instrumentKey** (формат scanner
`arb:{chainId}:{addr0}-{addr1}`), НЕ из payload. Parse по `:`; если pair=addresses
(regex `0x[a-fA-F0-9]{40}`)→directly; иначе ticker→address через
`@arbibot/contracts-eth` (WETH/USDC/USDT). decimals static map (WETH=18, USDC=6,
USDT=6).

**Pre-quoted amountIn (Модель #1, закрытие gap):** дополнительно
`computeAmountIns(tokens, notionalUsd, evidence) → {buyAmountIn, sellAmountIn}`:
- buyAmountIn = notional в USDC units ($10 → 10_000_000)
- sellAmountIn = ожидаемый amountOut из buy = `notional/buyPrice × 10^decimals0`
  (buyPrice из payload.evidence)

**fail-closed:** unknown token / нет цены → null → worker skip (metric
skip_no_token / skip_no_price). Никаких ручных адресов в auto path.

**UniV3 fee-tier:** Phase 2 (MVP UniV2 не имеет tiers).

**Файлы:**
- `apps/opportunity-service/src/opportunities/token-resolver.service.ts`
- `apps/opportunity-service/src/opportunities/token-resolver.service.spec.ts`

**DoD:** spec — parse address pair, ticker→address для staples, amountIn calc из
цены, unknown→null, malformed→null. Reverted-sell risk задокументирован.

- **depends_on:** —
- **status:** `proposed`

---

## P10-4 — PlanSetupOrchestrator (opp-service, setup-only saga)

- **step_id:** `P10-4-LIVE-PLAN-SETUP`
- **Вектор:** FUNC (SEC)
- **gate:** live-blocker

**Риск:** нет компонента, который связывает opportunity → execution plan. Все
endpoints существуют, но не вызываются автоматически.

**Реализация:** `orchestrate({opportunity,tokens,amountIns,notionalUsd,
correlationId}) → {planId, reservationId}`. Setup-only saga (5 шагов, pre-quoted
amountIn на обе legs):

1. `POST /execution/plans/multi-leg` `{correlationId, riskDecisionId, routeKey,
   notionalUsd, slippageBps:dex.limits.maxSlippageBps(50), legs:[{legType:'dex',
   chainId, venueKey:buyVenue, tokenIn:USDC, tokenOut:MAGIC, amountIn:buyAmountIn},
   {legType:'dex', chainId, venueKey:sellVenue, tokenIn:MAGIC, tokenOut:USDC,
   amountIn:sellAmountIn}]}` (recipient ОПУСКАЕТСЯ — EO резолвит; amountIn pre-set
   на обе legs) → planned
2. `POST /capital/reservations` `{correlationId, planId, amountUsd:notionalUsd,
   ttlSeconds:300}` → active
3. `POST /execution/plans/:id/link-reservation` `{capitalReservationId}` → reserved
4. `POST /execution/plans/:id/arm` → armed
5. `POST /execution/plans/:id/begin-execution` → executing, legs created

**Cleanup на failure setup:** release reservation (idempotent best-effort). Capital
release на completion делает settlement-relay EO (независим от worker).

**Файлы:**
- `apps/opportunity-service/src/opportunities/plan-setup-orchestrator.service.ts`
- `apps/opportunity-service/src/opportunities/plan-setup-orchestrator.service.spec.ts`

**DoD:** spec — happy path 5 шагов, link/arm 4xx→cleanup+release, idempotent
release.

- **depends_on:** P10-3 (amountIn), P10-AMT (notional fallback в EO)
- **status:** `proposed`

---

## P10-5 — LiveAutoDriveWorker (opp-service)

- **step_id:** `P10-5-LIVE-AUTO-DRIVE`
- **Вектор:** FUNC (SEC)
- **gate:** live-blocker

**Риск:** нет worker'а, который автоматически забирает risk_checked opportunities
и запускает plans. Текущий AutoDriveWorker (opp-service) идёт только в paper.

**Реализация:** клон paper worker (paper-trading-service), НЕ простого opp-service.
Inject: configService (P10-1), killSwitch (P10-2), tokenResolver (P10-3),
planSetup (P10-4), `@InjectRepository(ArbitrageOpportunityEntity)`.

`onModuleInit` регистрирует таймер ВСЕГДА (даже если disabled — config-service
может flip без restart); `onModuleDestroy` isShuttingDown+clearInterval;
`trigger()` manual hook.

**Top-of-tick guards** (verbatim из paper): isShuttingDown→return; isRunning→return;
`await ensureEffectiveConfigLoaded()`; if(!isEnabled()){disabled;return};
isRunning=true; try{assertLiveNotHalted(); tickInner} catch{halted→metric|error}.

**Tick:** SELECT WHERE state='risk_checked' AND live_execution_plan_id IS NULL LIMIT
batchSize; concurrent-limit COUNT active markers; per opp: re-check kill;
netProfitUsd≥min?; tokens+amountIns=resolve→null?skip; result=planSetup;
**UPDATE SET live_execution_plan_id WHERE id AND IS NULL** (optimistic, loser skip).

**Metrics** `arb_live_auto_drive_*`: cycles{status=success|error|disabled|halted},
plans_created{outcome}, profit_usd hist, latency_ms hist.

**Файлы:**
- `apps/opportunity-service/src/opportunities/live-auto-drive.worker.ts`
- `apps/opportunity-service/src/opportunities/live-auto-drive.worker.spec.ts`
- `apps/opportunity-service/src/opportunities/opportunities.module.ts` (providers)

**DoD:** spec — disabled→no tick, halted→no tick, happy path (1 opp→plan created→
marker set), skip_no_token, reentrancy guard, dedup (opp с marker не поднимается).

- **depends_on:** P10-1, P10-2, P10-3, P10-4
- **status:** `proposed`

---

## P10-EO — LegAutoDriverWorker (execution-orchestrator, НОВЫЙ)

- **step_id:** `P10-EO-LEG-AUTO-DRIVER`
- **Вектор:** REL (SEC)
- **gate:** live-blocker

**Риск:** после `begin-execution` legs остаются в `created` навсегда — EO не
драйвит их автоматически. Без driver = зомби-планы.

**Реализация:** `implements OnModuleInit/OnModuleDestroy`. Inject: legsService (DI,
НЕ HTTP), killSwitch (DexKillSwitchService — в EO), plansService.
`LEG_AUTO_DRIVE_ENABLED` env (default false, safe-by-default). Interval env
`LEG_AUTO_DRIVE_INTERVAL_MS` (default 2000, min 500).

**Tick (с правками Гермеса Р2-1/3/4):**

1. **Р2-4 live-only filter:** `SELECT legs WHERE state='created' AND
   isLiveVenueKey(venueKey) AND plan.state='executing'` (`isLiveVenueKey` из
   `venue-factory.service.ts:52`, исключает paper-dex)
2. **Р2-3 sequential (НЕ Promise.all):** per leg в цикле for (buy→sell), не
   параллельно (арбитраж semantically buy-first; снимает nonce-гонку):
   - `await killSwitch.assertLiveNotHalted()` (throws→skip, metric halted)
   - `await legsService.markSent(planId, legId)`
   - **Р2-1 state check после markSent:** re-fetch leg; if
     `state==='submitting'`→**skip** (tx pending, ждать stuck-plan-reaper; НЕ
     вызывать markAcknowledged — упадёт Conflict, требует строго `sent`
     `legs.service.ts:688-691`); if `state==='sent'`→continue
   - `await legsService.markAcknowledged(planId, legId)` (только если sent)
   - `await legsService.applyFill(planId, legId, {mode:'full', idempotencyKey})`
     → filled; sell amountIn уже pre-set (Модель #1, P10-3)
3. после всех legs filled → plansService.tryMarkPlanCompletedWhenAllLegsFilled →
   emit PlanCompleted

**Error handling:**
- markSent 422 (client/terminal)→leg failed, log+metric (план не completed, reaper
  alert 30мин)
- markSent 503 transient→leg остаётся submitting (worker skip на след. tick;
  stuck-plan-reaper восстановит ~5-6мин)
- kill-switch 409→skip leg
- **reverted sell leg (Р2-5 risk):** если sell revert'нулась из-за неверного amountIn
  (buy получил меньше ожидаемого)→leg failed→stuck-plan-reaper→**manual
  intervention** (бот остался с токеном; для $10 потеря=gas, приемлемо)

**Isolation:** on-chain tx НЕ внутри DB-tx (P9-1 двухфазный markSent:
created→submitting commit, broadcast outside tx, submitting→sent commit).

**Файлы:**
- `apps/execution-orchestrator/src/legs/leg-auto-driver.worker.ts`
- `apps/execution-orchestrator/src/legs/leg-auto-driver.worker.spec.ts`
- `apps/execution-orchestrator/src/legs/legs.module.ts` (providers)

**DoD:** spec — happy path (2 legs→completed, sequential), kill-switch skip,
submitting→skip (Р2-1), 422 leg failed, transient→reaper, reverted-sell→manual
path, live-only filter (paper-dex не поднимается), reentrancy. CI: зомби-план
impossible (worker стартует только при LEG_AUTO_DRIVE_ENABLED=true).

- **depends_on:** —
- **status:** `proposed`

---

## P10-FB — Live completion callback (HTTP, НЕ outbox read)

- **step_id:** `P10-FB-LIVE-COMPLETION-CALLBACK`
- **Вектор:** REL (ARCH)
- **gate:** live-blocker

**Риск (Р1-6/Р2-6 Гермеса, подтверждён):** `planCompleted` уже в allowlist у 2
consumer'ов (settlement-relay EO + kafka-bridge). Общая колонка `processed_at` →
race, первый забравший лишает второго. Opp-service не может читать outbox_events
EO напрямую — событие потеряется.

**Реализация:** HTTP callback в существующий settlement-relay (НЕ новый consumer).

**EO settlement-relay** (`legs/settlement-relay.worker.ts`, уже обрабатывает
PlanCompleted для capital release) расширяется: после capital release →
`signedFetch POST {OPP_API_BASE}/opportunities/:planId/live-completed` с заголовком
`x-arbibot-msg-id` (messageId из PlanCompleted outbox) для idempotency. HMAC через
`ARBIBOT_SERVICE_AUTH_SECRET` (D4-B-6, уже между сервисами).

**Opp-service** — НОВЫЙ endpoint `POST /opportunities/:planId/live-completed`
(mutation, single-writer=opp-service): `UPDATE arbitrage_opportunities SET
state='live_completed' WHERE live_execution_plan_id=planId`. Idempotency: проверка
текущего state (уже live_completed→200 no-op).

**Почему НЕ outbox read:** HTTP callback — ноль новых consumer'ов outbox,
переиспользует существующий relay.Race невозможен.

**Файлы:**
- `apps/execution-orchestrator/src/legs/settlement-relay.worker.ts` (+ callback)
- `apps/opportunity-service/src/opportunities/opportunities.controller.ts` (+endpoint)
- `apps/opportunity-service/src/opportunities/opportunities.service.ts` (+метод)
- specs для обоих

**DoD:** spec — callback отправляется после capital release, idempotent replay
(уже completed→no-op), opp state update, HMAC проверка.

- **depends_on:** P10-6 (колонка live_execution_plan_id)
- **status:** `proposed`

---

## P10-AMT — notional→amountIn в beginExecution (fallback)

- **step_id:** `P10-AMT-NOTIONAL-TO-AMOUNTIN`
- **Вектор:** FUNC (SEC)
- **gate:** paper-check (fallback path; основной — pre-quoted из P10-3)

**Риск (Р2-2 Гермеса, подтверждён):** `CreateMultiLegPlanDto` требует `amountIn`
на каждой leg. Worker передаёт notional → нужна конверсия. Builder не имеет
PriceOracle (`multi-leg-plan-builder.service.ts:92-98`), LegsService имеет
costEstimator (`:154`, через него транзитом PriceOracle).

**Реализация:** расширить `CreateMultiLegPlanDto` опциональным `notionalUsd?:
number` (plan-level). В `LegsService.beginExecution`: если leg.amountIn не задан И
notionalUsd задан → конвертировать через `PriceOracleService` → заполнить legs
перед create.

**Fallback:** если amountIn уже pre-set (Модель #1 из worker, P10-3) →
использовать как есть, notionalUsd игнорируется. Slippage: worker передаёт
`slippageBps=dex.limits.maxSlippageBps` (50) на legs.

**Файлы:**
- `apps/execution-orchestrator/src/plans/dto/create-multi-leg-plan.dto.ts` (+notionalUsd)
- `apps/execution-orchestrator/src/legs/legs.service.ts` (beginExecution +конверсия)
- specs

**DoD:** spec — notional→amountIn fallback (когда amountIn отсутствует), pre-set
amountIn приоритетнее, decimals-correct, fail-closed при отсутствии цены.

- **depends_on:** —
- **status:** `proposed`

---

## P10-6 — Миграции

- **step_id:** `P10-6-MIGRATIONS`
- **gate:** live-blocker (ops)

**053** (клон 047, namespace `live.auto_drive`): INSERT policy_configurations
`'live.auto_drive'`, config_value
`{"enabled":false,"minNetProfitUsd":5,"maxConcurrentPlans":3,"notionalUsd":50}`,
is_sensitive=false, scope global, WHERE NOT EXISTS.

**054:** `ALTER TABLE arbitrage_opportunities ADD COLUMN IF NOT EXISTS
live_execution_plan_id uuid NULL;` + partial index
`WHERE state='risk_checked' AND live_execution_plan_id IS NULL` (created_at DESC).

**Файлы:**
- `infra/postgres/migrations/053_live_auto_drive_seed.sql`
- `infra/postgres/migrations/054_arbitrage_opportunities_live_plan_id.sql`

**DoD:** `npm run db:migrate` зелёный; `db:verify-migrations` 053/054.

- **depends_on:** —
- **status:** `proposed`

---

## P10-7 — Panic-button + recover extension

- **step_id:** `P10-7-PANIC-SCRIPTS`
- **gate:** live-blocker (ops)

**panic-button.sh:** добавить `flip_env "LIVE_AUTO_DRIVE_ENABLED" "false"` +
`flip_env "LEG_AUTO_DRIVE_ENABLED" "false"` после paper flip (~:144); добавить
opportunity-service + execution-orchestrator в RESTART_SERVICES.

**panic-recover.sh:** **НЕ восстанавливать** оба (mirror paper `:135-137` — recovery
must NEVER auto-restart automated live trading).

**Файлы:**
- `tools/panic-button.sh`
- `tools/panic-recover.sh`

**DoD:** dry-run panic-button показывает оба flip; recover не восстанавливает.

- **depends_on:** —
- **status:** `proposed`

---

## P10-8 — Targeted tests (crash/concurrency/recovery, parity P9-13)

- **step_id:** `P10-8-TARGETED-TESTS`
- **Вектор:** TEST (SEC)
- **gate:** live-blocker

**Сценарии:**

**(a) opp-service:** crash mid-setup (orchestrator падает после createPlan до
begin)→повторный tick не дубликат (dedup колонка+optimistic UPDATE); concurrent
workers (два tick→loser skip); kill-switch mid-setup→cleanup+release.

**(b) execution-orchestrator (Р2-1/3/4/5):** submitting-skip (markSent timeout→worker
skip, reaper восстановит); sequential (buy→fill→sell); live-only (paper-dex не
поднимается); reverted-sell (Р2-5: sell revert→leg failed→manual).

**(c) feedback (Р2-6):** HTTP callback→opp state; idempotent replay.

CI `e2e-singlechain-live-readiness` (P9-13) расширить: default enabled=false (оба
worker не стартуют без явного opt-in).

**Файлы:** в рамках specs P10-5, P10-EO, P10-FB (кризисные сценарии в specs).

**DoD:** все spec-сценарии зелёные.

- **depends_on:** P10-5, P10-EO, P10-FB
- **status:** `proposed`

---

## P10-9 — Single-chain live auto-drive smoke

- **step_id:** `P10-9-LIVE-SMOKE`
- **Вектор:** REL (DEVOPS)
- **gate:** live-blocker

Manual DoD: `LIVE_AUTO_DRIVE_ENABLED=true` + `LEG_AUTO_DRIVE_ENABLED=true` +
`DEX_VENUE_ENABLED=true` на testnet → opp risk_checked → worker создаёт plan
(staples, pre-quoted) → LegAutoDriver sequential доводит legs до filled →
settlement-relay callback → opp state updated.

**Файлы:** `docs/live-auto-drive-smoke-<date>.md` (запись результата, по образцу
`docs/live-smoke-runbook.md`).

**DoD:** smoke passed, запись с результатами каждой фазы.

- **depends_on:** P10-1…P10-FB, P10-6, P10-7
- **status:** `proposed`

---

## P10-gate (DoD)

- build 22/22 зелёный; lint 29/29 0 errors
- `npm test -w @arbibot/opportunity-service` + `-w @arbibot/execution-orchestrator`
  новые specs зелёные
- `npm run db:migrate` 053/054; `db:verify-migrations`
- `npm run smoke:live-testnet` (dry-run) — подтверждает gates (kill-switch, capital
  ceiling, recon), на которых построены оба worker
- Manual DoD P10-9 на testnet; запись в `docs/live-auto-drive-smoke-<date>.md`

---

## Маппинг на реестр инициатив roadmap-vectors.md

> Вносится в `docs/roadmap-vectors.md` §5 при старте плана.

| # | step_id | Вектор(ы) | gate | impact | effort | score | status | plan |
|---|---------|-----------|------|--------|--------|-------|--------|------|
| 35 | `FUNC-LIVE-AUTO-CONFIG` | FUNC (SEC) | live-blocker | 4 | 1 | 20 | done | PLAN10 (`P10-1`) |
| 36 | `SEC-LIVE-KILL-SWITCH-READ` | SEC (FUNC) | live-blocker | 4 | 2 | 16 | done | PLAN10 (`P10-2`) |
| 37 | `FUNC-TOKEN-RESOLVER` | FUNC (SEC) | live-blocker | 4 | 3 | 12 | done | PLAN10 (`P10-3`) |
| 38 | `FUNC-LIVE-PLAN-SETUP` | FUNC (SEC) | live-blocker | 4 | 3 | 12 | done | PLAN10 (`P10-4`) |
| 39 | `FUNC-LIVE-AUTO-DRIVE` | FUNC (SEC) | live-blocker | 5 | 3 | 15 | done | PLAN10 (`P10-5`) |
| 40 | `REL-LEG-AUTO-DRIVER` | REL (SEC) | live-blocker | 5 | 4 | 10 | done | PLAN10 (`P10-EO`) |
| 41 | `REL-LIVE-COMPLETION-CALLBACK` | REL (ARCH) | live-blocker | 3 | 2 | 12 | done | PLAN10 (`P10-FB`) |
| 42 | `FUNC-NOTIONAL-TO-AMOUNTIN` | FUNC (SEC) | paper-check | 3 | 2 | 12 | in-progress | PLAN10 (`P10-AMT`) — DTO поле добавлено (787fc38); runtime конверсия = Phase 2 |
| 43 | `TEST-LIVE-AUTO-DRIVE` | TEST (SEC) | live-blocker | 4 | 3 | 12 | done | PLAN10 (`P10-8`) |
| 44 | `REL-LIVE-AUTO-DRIVE-SMOKE` | REL (DEVOPS) | live-blocker | 3 | 2 | 12 | proposed | PLAN10 (`P10-9`) — dedicated smoke не создан, переиспользуется PLAN8 `smoke:live-testnet` |

> P10-6 (migrations) и P10-7 (panic-scripts) — не кодовые инициативы, в реестр не
> вносятся (по P5: реестр не дублирует операционный трекер).

---

## Capital-safety checklist

- [x] `LIVE_AUTO_DRIVE_ENABLED=false` + `LEG_AUTO_DRIVE_ENABLED=false` default (env+seed)
- [x] Kill-switch fail-closed prod (оба worker проверяют)
- [x] Дедупликация plans (колонка + optimistic UPDATE)
- [x] Capital release независим от worker (settlement-relay EO по PlanCompleted)
- [x] On-chain broadcast изолирован в EO (WalletManager/RPC рядом)
- [x] Token resolver fail-closed (unknown→skip)
- [x] notional tightening: `min(live.auto_drive, dex.limits.maxNotionalPerTradeUsd)`
- [x] Cost-gate 422 respected (begin-execution может блокировать)
- [x] Panic-button глушит оба worker; panic-recover НЕ восстанавливает
- [x] Paper path НЕ трогается (отдельный worker/config/timer)
- [x] `maxConcurrentPlans` limit (не насыщает capital ceiling)
- [x] **Reverted-sell recovery → manual** (Р2-5: stuck-plan-reaper → operator)
- [x] **Feedback без outbox race** (Р2-6: HTTP callback, ноль новых consumer'ов)
