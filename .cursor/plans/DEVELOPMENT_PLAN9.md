# DEVELOPMENT_PLAN9 — Single-chain Arbitrum live-readiness

> **Назначение:** третий план улучшений на базе системы векторов
> ([`docs/roadmap-vectors.md`](../../docs/roadmap-vectors.md)). Скоуп сформулирован
> из **глубокого аудита кода 2026-08-03** (чтение ~2000 LOC execution-orchestrator
> + bridges + capital + vault + reconciliation, 4 параллельных Explore-агента), а не
> из документации.
>
> **Принципы (из roadmap-vectors.md §1):** P1 — код-first (все формулировки ниже
> основаны на чтении файлов 2026-08-03, file:line могут сместиться — исполнитель
> повторно сверяет перед стартом); P2 — пост-разработка = обновление доков.
>
> **Контекст:** PLAN7 закрыл инфраструктурные live-blocker'ы; PLAN8 закрыл
> корректность live-gate + enablement поверхностей (wallet-key import, smoke
> script, pg_dump). **Аудит 2026-08-03 выявил, что код execution-пути к
> реальной отправке on-chain транзакций недореализован:** broadcast идёт внутри
> DB-транзакции, `on_chain_transactions` никогда не пишется, нет nonce-менеджмента,
> reconciliation-детекторы мёртвые, live slippage-gate всегда проходит. План
> Гермеса («система на ~75%, нужны кошелёк+RPC+capital env») измерял операционную
> готовность и простамповал DEX/Bridge/Risk как ✅ READY — это **неверно** на
> уровне кода. Данный план закрывает кодовые дыры перед включением live.
>
> **Scope decision (user-approved 2026-08-03):** **(A) Узкий — Arbitrum
> single-chain live.** Cross-chain (мосты: неверные адреса, fake Stargate ABI,
> false-positive L2→L1 completion, отсутствие prove/finalize) вынесен в
> **отдельный Plan 10** после того, как single-chain докажет устойчивость на
> реальных деньгах. Bridge-адаптеры в этом плане **не правятся** — они
> **остаются halt'нутыми** kill-switch + `DEX_VENUE_ENABLED=false` для bridge
> venue keys на время всего Plan 9.

---

## Сводка шагов

| step_id | Вектор | gate | Тип | impact/effort | status |
|---------|--------|------|-----|---------------|--------|
| `P9-1-BROADCAST-IDEMPOTENCY` | SEC (REL) | live-blocker | баг | 5/4 (L) | `proposed` |
| `P9-2-ONCHAIN-TX-PERSIST` | REL (SEC) | live-blocker | пробел | 5/3 (M) | `proposed` |
| `P9-3-NONCE-LOCK` | SEC (FUNC) | live-blocker | пробел | 5/3 (M) | `proposed` |
| `P9-4-TXWAIT-TIMEOUT` | REL (SEC) | live-blocker | пробел | 4/2 (S) | `proposed` |
| `P9-5-LIVE-SLIPPAGE-GATE` | SEC (FUNC) | live-blocker | баг | 5/3 (M) | `proposed` |
| `P9-6-APPROVE-SWAP-WALLET` | SEC | live-blocker | баг | 4/2 (S) | `proposed` |
| `P9-7-RECON-CRON-REAPER` | REL | live-blocker | пробел | 5/3 (M) | `proposed` |
| `P9-8-SETTLEMENT-OUTBOX` | REL (ARCH) | live-blocker | пробел | 4/4 (L) | `proposed` |
| `P9-9-CAPITAL-IDEMPOTENCY` | SEC | live-blocker | пробел | 3/2 (S) | `proposed` |
| `P9-10-VAULT-SALT-ASSERT` | SEC | live-blocker | пробел | 3/1 (XS) | `proposed` |
| `P9-11-GAS-POLICY-CLAMP` | SEC (FUNC) | paper-check | баг | 3/2 (S) | `proposed` |
| `P9-12-OPS-PREREQ` | DEVOPS (SEC) | live-blocker | ops | 4/1 (S) | `proposed` |
| `P9-13-SINGLECHAIN-SMOKE` | REL (DEVOPS) | live-blocker | тест | 4/2 (S) | `proposed` |

**Порядок выполнения (по зависимостям + гейт-логике):**

```
P9-10 (XS, runtime safety) ─┐
P9-9  (S, capital idempotency) ─┤
P9-6  (S, approve/swap wallet) ─┼─► P9-1 (L, broadcast idempotency) ─► P9-2 (M, onchain persist)
P9-4  (S, tx.wait timeout) ─────┘            ▲                              │
P9-3  (M, nonce lock) ───────────────────────┘                              ▼
                              P9-5 (M, live slippage gate) ◄── P9-1 (needs OnChainTx for receipt)
P9-7 (M, recon cron + reaper) ─► P9-8 (L, settlement outbox) ─► P9-13 (S, single-chain smoke)
P9-11 (S, gas clamp) — независим, paper-check gate
P9-12 (S, ops prereq) — параллельно, операционная работа оператора
```

**Гейт P9:** все `live-blocker` шаги `done` + CI green + paper-deploy smoke passed
→ включение `DEX_VENUE_ENABLED=true` для Arbitrum single-chain валидно (с
минимальным капиталом, под наблюдением).

---

## Аудит кода 2026-08-03 — ключевые находки (основа плана)

Полный аудит выполнен чтением кода (4 параллельных Explore-агента + прямая
верификация grep'ом). Ниже находки, сформировавшие шаги. Каждая подтверждена
`file:line`.

### CRITICAL — прямой риск потери капитала

1. **Broadcast on-chain tx ВНУТРИ DB-транзакции.** `markSent()`
   (`apps/execution-orchestrator/src/legs/legs.service.ts:339-477`) оборачивает
   **всё** в `dataSource.transaction()`, включая `venue.submitLeg()` →
   `wallet.sendTransaction()` + `tx.wait(1)`. Если DB-коммит падает **после**
   успешного broadcast → tx уже в mempool, leg остаётся в `created` → retry
   отправит **вторую** tx (double-spend того же капитала). `tx.wait(1)` держит
   DB-транзакцию открытой ~12с на L1.
   → **P9-1**

2. **`on_chain_transactions` никогда не пишется (dead subsystem).** Подтверждено
   grep'ом: `OnChainTransaction` только читается
   (`dex-fill-tracker.service.ts:62,72`, `legs.service.ts:649`),
   **0 writers** в адаптерах. `DexOutboxEventsService.emitSubmitted/Confirmed/Failed`
   зарегистрирован в DI (`execution.module.ts:64,96`), но **0 call sites**.
   Каскад: `applyFill` enrich всегда `undefined` → `notional_usd = 0` → D4-B-3
   capital ceiling недосчитан; DEX reconcile-детекторы
   (`dex_receipt_leg_mismatch`, `dex_stale_pending_tx`) JOIN к пустой таблице →
   **всегда 0 rows**. Нет durable record broadcast'нутых tx.
   → **P9-2**

3. **Нет nonce-менеджмента (double-spend / stuck wallet).** `nonce` **нигде не
   передаётся** в `sendTransaction` (пустой grep по адаптерам).
   `WalletManagerService.selectWallet()`
   (`apps/execution-orchestrator/src/execution/wallet-manager.service.ts:130-132`)
   создаёт `new Wallet(privateKey, provider)` per-call; ethers независимо читает
   nonce из RPC. Multi-leg план с одним кошельком → гонка nonce → одна tx падает
   «nonce too low», **или** зависший nonce блокирует все tx кошелька.
   → **P9-3**

4. **`tx.wait(1)` без timeout (10 мест).** `biswap-v2.adapter.ts:199`,
   `pancakeswap-v2.adapter.ts:212`, `uniswap-v2.adapter.ts:508`,
   `uniswap-v3.adapter.ts:398`, `across-bridge.adapter.ts:192`,
   `native-bridge.adapter.ts:676,750,822`, `stargate-bridge.adapter.ts:189`,
   `token-approve.service.ts:124`. Ни один без `Promise.race`/timeout. На
   congestion/underpriced tx зависает навсегда, удерживая DB-транзакцию (см. #1).
   → **P9-4**

### HIGH — некорректное/небезопасное исполнение

5. **Live slippage-gate «вакуумный».**
   `apps/execution-orchestrator/src/execution/adapters/uniswap-v2.adapter.ts:331-344`
   + `dex-risk-policy.service.ts:195` — gate сравнивает
   `estimatedSlippageBps = getSlippageBps(tolerance=50)` с `maxSlippageBps=50`
   → `50 > 50 = false` → **всегда проходит**. Реальный price impact из
   `SlippageProtectionService.estimateSlippage` считается, но не передаётся в
   gate. Своп с 49% реальным impact пройдёт.
   → **P9-5**

6. **ERC20 approve: approve и swap идут с разных кошельков.**
   `apps/execution-orchestrator/src/execution/token/token-approve.service.ts:97`
   — `selectWallet(chainId, provider)` без token/amount → round-robin выбирает
   кошелёк A. Adapter уже выбрал кошелёк B (с token+amount). Allowance читается
   для B, approve летит с A → infinite loop (allowance всегда 0) или revert.
   → **P9-6**

7. **Reconciliation: нет cron + нет stuck-plan reaper.** В `reconciliation-service`
   нет `@Cron`/`setInterval` (пустой grep). `runDetectors` вызывается только по
   ручному `POST /mismatches/run-detectors`. **Нет worker'а**, детектящего планы,
   застрявшие в `armed`/`executing` или legs в `created`/`sent`. Зависший leg
   держит capital reservation бесконечно (до ручного release).
   → **P9-7**

8. **Settlement (portfolio/capital) — post-commit HTTP без resume.**
   `apps/execution-orchestrator/src/legs/fill-outbound.service.ts:46-64` —
   после commit leg=`filled` HTTP-вызовы к portfolio/capital идут с 4 retry,
   **вне транзакции, без persistence**. Crash orchestrator между commit и
   успешным POST → portfolio-позиция отсутствует, capital не освобождён,
   outbox-row остался unprocessed. Нет relay-воркера (как в opportunity-service).
   Дублирует дыру #2.
   → **P9-8**

9. **`VAULT_MASTER_KEY_SALT` runtime-фолбэк на захардкоженный salt.**
   `packages/nest-platform/src/vault/key-vault.service.ts:93-101` — при
   отсутствии env тихо использует `'arbibot-vault-salt-v1'` + `warn`.
   `validate-env.sh` ловит только deploy-time. Runtime не fail-closes.
   → **P9-10**

10. **Capital reservation: нет UNIQUE(correlation_id) + нет sweeper.**
    `apps/capital-service/src/capital/capital.service.ts:70-164` — DTO принимает
    `correlationId`, но `capital_reservations` (LIVE, создана в `001_core.sql`)
    **без UNIQUE(correlation_id)**. Retry HTTP POST `/capital/reservations` →
    **double-reservation**. Expiry только lazy (`getById`/`release`) — нет
    sweeper → просроченные reservations бесконечно съедают ceiling.
    → **P9-9**

11. **Gas-policy clamp не применяется (dead code).**
    `apps/execution-orchestrator/src/execution/gas/gas-estimator.service.ts:228-270`
    — `shouldReject`/`getCappedFeeData` определены, **0 callers**. Adapters
    проверяют `withinPolicy`, но priority-fee exceedance только warn.
    Фактический `maxPriorityFeePerGas` в `sendTransaction` — uncapped.
    → **P9-11** (paper-check — overspend, не capital loss)

### Опровержение (находка аудита оказалась неверной)

- **«execution-orchestrator не вызывает PinoLoggerService»** (subagent K3) —
  **ОПРОВЕРГНУТО.** `main.ts:31` вызывает
  `configureArbibotLogger(app, 'execution-orchestrator')`. Redact-конфиг
  применяется. В план **не включено**.

---

## Out of scope (явно отложено)

- **Cross-chain / bridges целиком** (audit C5/C6: неверные mainnet-адреса
  Arbitrum Inbox `0x6c5c509c...`, OP Portal `0xbEb5Fc579115...`, Stargate
  placeholder одинаковый на 4 сетях `0x9aA8E211...`; fake Stargate `swap()` ABI
  без `destinationChainId`; LayerZero EID≠EVM chainId; false-positive L2→L1
  completion `native-bridge.adapter.ts:531-536`; отсутствие prove/finalize).
  → **PLAN10** «Cross-chain live-readiness». Bridge venue keys остаются
  halt'нутыми на весь Plan 9.
- **MEV mempool monitor** (`dex-mempool-monitor.worker.ts:150` — `checkMevRisk()`
  0 callers; env mismatch `MEMPOOL_MONITOR_ENABLED` vs `DEX_MEMPOOL_ENABLED`).
  → backlog (nice-to-have, не capital loss; Arbitrum sequencer снижает MEV-риск).
- **Price oracle depeg-check / V3 pools** (`price-oracle.service.ts:63,133`).
  → backlog (влияет на точность ceiling, не блокирует single-chain USDC-пары).
- **Coverage gap scanner↔execution** (PancakeSwap V3, Velodrome без адаптеров).
  → backlog (Plan 8 finding #7; не блокирует UniV2/V3 на Arbitrum).
- **Газ в сканере.** Гермес пометил как нужное; это улучшение прибыльности, не
  блокер (execution уже считает через `TradeCostEstimator`). → backlog.

---

## P9-1 — Broadcast idempotency (broadcast вынести из DB-транзакции)

- **step_id:** `P9-1-BROADCAST-IDEMPOTENCY`
- **vector:** `SEC` (вторичный `REL`)
- **gate:** `live-blocker`
- **service:** `apps/execution-orchestrator`
- **goal:** Устранить double-spend при crash между broadcast и commit.
  Currently `markSent()` держит `wallet.sendTransaction()` + `tx.wait(1)`
  внутри `dataSource.transaction()` — если коммит падает после broadcast, retry
  отправит вторую tx.
- **code-first verify (перед стартом):**
  - `sed -n '339,477p' apps/execution-orchestrator/src/legs/legs.service.ts` →
    `dataSource.transaction(async (em) => {... venue.submitLeg(plan, leg) ...})`.
  - `apps/execution-orchestrator/src/venue/venue-adapter.ts:10` —
    `VenueSubmitTransientError` коммент: «leg stays `created`; caller may retry».
    Это ложь при broadcast-then-crash.
- **approach (two-phase mark-sent):**
  1. **Phase 1 (inside tx):** leg `created → submitting` (новое переходное
     состояние state machine); persist `OnChainTransaction(status='pending')` со
     всеми известными полями (chainId, legId, fromAddress, gasLimit/price из
     gas-estimator, **присвоенный nonce** из P9-3). Emit
     `DexTransactionSubmitted` (P9-2). **Commit.**
  2. **Phase 2 (outside tx):** `wallet.sendTransaction({ nonce, ... })`.
  3. **On success:** tx.wait (P9-4 timeout) → update `OnChainTransaction` →
     `confirmed`; leg `submitting → sent`; commit.
  4. **On crash before Phase 2:** leg stuck в `submitting` с pending
     `OnChainTransaction` → **stuck-plan reaper** (P9-7) детектит и либо
     re-submit'ит (по nonce из pending row), либо помечает failed после
     timeout.
  5. **On `VenueTerminalSubmitError`:** leg → terminal state (как сейчас).
- **HTTP-контракт `markSent` (B1 — фиксация модели):** endpoint остаётся
  **синхронным** — блокирует до завершения Phase 2 и возвращает `legView` со
  `state='sent'` (как сегодня). Поведение по веткам:
  - **Успех Phase 2:** leg=`sent`, возвращается нормально.
  - **Transient error в Phase 2** (`tx.wait` timeout, RPC drop): leg остаётся
    `submitting`; endpoint кидает `503/504` (transient) → клиент НЕ должен
    ретраить `markSent` (precondition `created` упадёт в `ConflictException`);
    recovery делегирован **reaper'у** (P9-7), который проверит pending
    OnChainTransaction (P9-2) и confirmation-poller'ом (P9-4) установит финальное
    состояние. Это явно зафиксировано в ADR (см. P9-gate §docs).
  - **`VenueTerminalSubmitError`:** leg→terminal, как сегодня.
  - **Crash процесса:** leg=`submitting` (Phase 1 committed) → reaper на restart.
  - Это устраняет double-spend: повторный `markSent` невозможен (state guard),
    единственный recovery-path — reaper через проверку on-chain статуса.
- **state machine change (SM1 — полный набор переходов):** `ExecutionLeg`
  state enum расширяется `submitting`. Полный контракт переходов:
  ```
  created → submitting → sent → acknowledged → (partiallyFilled ↔ acknowledged) → filled
                       ↘ failed (VenueTerminalSubmitError / reaper after confirmed miss)
                       ↘ submitting (crash recovery via reaper, see below)
  ```
  Все precondition-чеки обновить:
  - `markSent` (line 359): `created → submitting` (раньше `created → sent`).
  - `markAcknowledged` (line 499): `sent → acknowledged` (без изменений, но
    `submitting` НЕ должно проходить — добавить явную проверку, что `submitting`
    не валиден для ack).
  - `applyFill` (line 574): `acknowledged|partiallyFilled → filled` (без изменений).
  - Новая recovery-точка: `submitting → sent|failed` через reaper (P9-7), не
    через `markSent`.
  - Прогнать grep всех потребителей `leg.state` (controllers, reconciliation,
    cross-chain service line 258) и убедиться, что `submitting` корректно
    обрабатывается (не считается terminal/filled).
- **acceptance_criteria:**
  - `venue.submitLeg()` / bridge submit **не** вызывается внутри открытой
    DB-транзакции.
  - Перед broadcast существует committed row в `on_chain_transactions` со
    status=`pending` и известным nonce.
  - HTTP `markSent` возвращает `sent` только при успехе Phase 2; при transient
    error возвращает `503/504` с leg=`submitting`.
  - Crash-тест: убить процесс после Phase 1 commit, до/во время Phase 2 →
    reaper (P9-7) восстанавливает консистентность (re-submit или failed) —
    повторного `markSent` не требуется и невозможно.
  - Unit-тест: mock `sendTransaction` throw после commit → leg остаётся
    `submitting`, `OnChainTransaction` row существует, повторный `markSent` →
    ConflictException.
  - `VenueSubmitTransientError` комментарий исправлен на фактическое поведение
    (leg stays `submitting` after Phase 1 commit, not `created`).
- **changed_areas:** `apps/execution-orchestrator/src/legs/legs.service.ts`,
  `packages/contracts/src/execution-leg-states.ts` (или где state enum),
  `packages/persistence/src/execution-leg.entity.ts` (если state typed),
  `apps/execution-orchestrator/src/execution/adapters/*.ts` (подпись — могут
  принимать pre-persisted OnChainTx вместо возврата txHash),
  `apps/execution-orchestrator/src/venue/venue-adapter.ts` (comment fix).
- **review_required:** `architecture` (state machine + single-writer),
  `dex-security` (broadcast boundary), `backend-review`
- **depends_on:** P9-3 (nonce), P9-2 (persist API), P9-4 (timeout)
- **status:** `proposed`

---

## P9-2 — On-chain transaction persistence + outbox wiring

- **step_id:** `P9-2-ONCHAIN-TX-PERSIST`
- **vector:** `REL` (вторичный `SEC`)
- **gate:** `live-blocker`
- **service:** `apps/execution-orchestrator`
- **goal:** Оживить dead subsystem: каждый DEX adapter пишет
  `OnChainTransaction` row + эмитит `DexTransaction*` outbox events. Без этого
  fill-enrichment всегда `undefined`, reconciliation-детекторы мёртвые, audit
  пруфы on-chain отсутствуют.
- **code-first verify (перед стартом):**
  - `grep -rn "onChainTxRepo.save\|INSERT.*on_chain_transactions" apps/` →
    **0 writers** (подтверждено).
  - `grep -rn "emitSubmitted\|emitConfirmed\|emitFailed" apps/ | grep -v spec |
    grep -v dex-outbox-events.service.ts` → **0 call sites** (подтверждено).
  - `packages/persistence/src/on-chain-transaction.entity.ts` — entity готова:
    `status: 'pending'|'confirmed'|'failed'|'reverted'`, `nonce`, `gasUsed`,
    `blockNumber`, `revertReason`. Миграция `033_dex_on_chain.sql` есть.
  - `DexOutboxEventsService.emitSubmitted(em, tx, correlationId)` — API готов,
    ожидает `EntityManager` для atomic-with-status-change (см. service comment
    line 47: «Should be called in the same transaction»).
- **single-writer invariant (B2 — обязательная фиксация):** writer'ом
  `on_chain_transactions` является **только execution-слой** (DEX adapters через
  выделенный `OnChainTransactionService`, вызываемый из `legs.service.ts` в
  рамках двухфазного mark-sent P9-1). `PlansService` в данный момент держит
  `@InjectRepository(OnChainTransaction)` (`plans.service.ts:54`) — проверить
  использование: если только для **read** (просмотр tx при getPlan) → оставить с
  явным комментарием `// READ-ONLY: single-writer = OnChainTransactionService`;
  если для write → **убрать** и заменить на read через сервис. Никакой другой
  сервис (capital, portfolio, reconciliation) не имеет репозитория к
  `on_chain_transactions`. Идеально — вынести всю запись в
  `OnChainTransactionService` (create pending / mark confirmed / mark failed),
  чтобы writers локализованы в одном классе.
- **consumers of `dexTransaction*` events (C2 — обязательная фиксация):**
  события `DexTransactionSubmitted/Confirmed/Failed` эмитятся в outbox, но
  **для audit-log + reconciliation-read**, не для синхронной обработки. Решение:
  эти события drain'ятся тем же settlement-relay (P9-8) только для marking
  `processed_at` (без side-effects) — либо помечаются processed при emit, если
  consumer не нужен (audit-only). **Недопустимо** оставлять их unprocessed навсегда
  (это создаст новый backlog, как сейчас с `legFilled`). В acceptance_criteria
  зафиксировать: либо consumer определён (reconciliation подписывается на
  `DexTransactionConfirmed` для подтягивания receipt-данных), либо
  `processed_at = NOW()` при emit (audit-only, задокументировано).
- **acceptance_criteria:**
  - Каждый DEX adapter (uniswap-v2/v3, sushiswap, pancakeswap, biswap) после
    `sendTransaction` (но до/вместе с `tx.wait`) persist'ит
    `OnChainTransaction(status='pending', txHash, nonce, gasLimit, gasPrice,
    maxFeePerGas, maxPriorityFeePerGas, fromAddress, toAddress, chainId, legId)`.
  - После `tx.wait`: update → `confirmed` (gasUsed, blockNumber, blockHash,
    transactionIndex, effectiveGasPrice) **или** `reverted` (revertReason) в той
    же транзакции, что и leg state change (atomic с P9-1).
  - `DexOutboxEventsService.emitSubmitted/Confirmed/Failed` вызываются в
    соответствующих переходах (Phase 1 pending → emitSubmitted; Phase 3
    confirmed/failed → emitConfirmed/Failed).
  - **(C1 — back-compat verify)** `legs.service.ts:649` `applyFill` enrich
    теперь находит confirmed row → `dexMeta` populated → `LegFilledPayloadV2`
    получает поле `dex`. Проверить, что **все consumers** `LegFilled`
    (portfolio-service `confirmPortfolio`) tolerant к появлению `dex` field
    (дополнительное поле, back-compat — field optional в payload v2). Добавить
    тест на portfolio confirm с populated dex vs undefined (оба работают).
  - `FillOutboundService` получает chainId → `notional_usd` корректно priced.
  - DEX reconcile-детекторы (`dex_receipt_leg_mismatch`,
    `dex_stale_pending_tx`) теперь имеют данные → детектят реальные расхождения.
  - **(B2)** `OnChainTransactionService` — единственный writer; `PlansService`
    read-only или делегирован; grep подтверждает 0 writers вне этого сервиса.
  - **(C2)** `dexTransaction*` outbox rows не накапливаются unprocessed
    (consumer определён ИЛИ marked processed at emit).
  - Unit-тест: adapter submit → assert OnChainTransaction row created with
    correct fields; `applyFill` returns non-null dexMeta.
- **changed_areas:** все `apps/execution-orchestrator/src/execution/adapters/*.ts`,
  новый `apps/execution-orchestrator/src/execution/on-chain-transaction.service.ts`
  (single-writer), `apps/execution-orchestrator/src/plans/plans.service.ts`
  (read-only audit), `apps/execution-orchestrator/src/execution/dex-fill-tracker.service.ts`
  (если нужно), тесты.
- **review_required:** `architecture` (single-writer on OnChainTransaction —
  обязательная проверка B2), `backend-review`
- **depends_on:** P9-1 (двухфазный mark-sent, куда persist встроен)
- **status:** `proposed`

---

## P9-3 — Per-wallet nonce lock + explicit nonce

- **step_id:** `P9-3-NONCE-LOCK`
- **vector:** `SEC` (вторичный `FUNC`)
- **gate:** `live-blocker`
- **service:** `apps/execution-orchestrator`
- **goal:** Устранить гонку nonce при параллельном multi-leg исполнении.
  Сейчас `selectWallet` создаёт `new Wallet(privateKey, provider)` per-call, ethers
  независимо читает nonce из RPC → concurrent legs выбирают один nonce →
  «nonce too low» или stuck mempool.
- **code-first verify (перед стартом):**
  - `grep -rn "nonce" apps/execution-orchestrator/src/execution/adapters/` →
    пусто (подтверждено: nonce не передаётся в sendTransaction).
  - `apps/execution-orchestrator/src/execution/wallet-manager.service.ts:130-132,
    317-348` — `selectWallet` создаёт Wallet; `updateWalletState` fire-and-forget
    читает `wallet.getNonce()` в `wallet_states`, но никто не читает обратно.
- **approach:**
  1. **In-process async-mutex per wallet address** (библиотека `async-mutex`
     или простой `Map<address, Promise>` chain). Все `sendTransaction` одного
     кошелька сериализуются.
  2. **Explicit nonce:** перед broadcast adapter читает nonce из локального
     трекера (или `provider.getTransactionCount(address, 'pending')` под локом),
     передаёт `{ nonce, ... }` в `sendTransaction`. После broadcast инкрементирует
     локальный счётчик.
  3. **Nonce persistence:** `wallet_states.nonce` обновляется **синхронно** (не
     fire-and-forget) под блокировкой; на старте процесса синхронизируется с RPC
     `max(local, rpcPending)`.
  4. **Gap detection:** если `provider.getTransactionCount < local` →
     `nonceDrift` alert (метрика `arb_wallet_nonce_drift`).
- **acceptance_criteria:**
  - `sendTransaction` во всех adapters + `token-approve.service.ts` передаёт
    явный `nonce`.
  - Concurrent 2+ legs на одном кошельке → разные nonce, ни одна tx не падает
    «nonce too low».
  - Unit-тест: parallel `selectWallet` → mock provider возвращает один nonce →
    mutex гарантирует serial increment.
  - `wallet_states.nonce` обновляется синхронно с broadcast.
- **changed_areas:** `apps/execution-orchestrator/src/execution/wallet-manager.service.ts`
  (nonce tracker + mutex), все adapters (передача nonce),
  `token-approve.service.ts`, возможно новый `nonce-manager.service.ts`.
- **review_required:** `dex-security`, `backend-review`
- **depends_on:** — (можно стартовать параллельно с P9-1)
- **status:** `proposed`

---

## P9-4 — tx.wait timeout + background confirmation poller

- **step_id:** `P9-4-TXWAIT-TIMEOUT`
- **vector:** `REL` (вторичный `SEC`)
- **gate:** `live-blocker`
- **service:** `apps/execution-orchestrator`
- **goal:** `tx.wait(1)` (10 мест) не имеет timeout — зависает навсегда на
  congestion/underpriced tx, удерживая DB-транзакцию (P9-1). Обернуть в
  `Promise.race` с chain-aware timeout + background poller для восстановления.
- **code-first verify (перед стартом):** см. finding #4 выше (10 `tx.wait(1)`
  sites без Promise.race).
- **approach:**
  1. **Helper `waitForConfirmation(tx, chainId, timeoutMs)`:** `Promise.race`
     между `tx.wait(1)` и timeout (Arbitrum/Base ~60s, BNB ~120s, L1 ~180s —
     chain-aware via `ChainId → finality` map, уже есть в
     `packages/contracts-eth/src/types/chain-id.ts:139`).
  2. **On timeout:** НЕ бросать сразу. Возвратить `pending` статус; tx остаётся
     в `on_chain_transactions(status='pending')` (P9-2).
  3. **Background confirmation poller** (новый worker): периодически проверяет
     pending OnChainTransaction rows через `provider.getTransactionReceipt(txHash)`
     → update to `confirmed`/`failed`/`reverted`, применяет fill (если ещё не
     applied) или помечает stuck.
  4. **Chain-specific confirmations:** для finality-sensitive operations
     `tx.wait(N)` где N из finality map (BNB ≥3).
- **acceptance_criteria:**
  - Ни один `tx.wait(1)` не вызывается без timeout.
  - Timeout не теряет tx: pending row остаётся, poller подхватывает.
  - Unit-тест: mock `tx.wait` hang → helper returns pending после timeout;
    poller later resolves via mock receipt.
  - Worker имеет метрику `arb_execution_tx_confirmation_lag_seconds`.
- **changed_areas:** все adapters + bridges (но bridges в scope не идут —
  только пометить TODO для Plan 10), новый helper в
  `apps/execution-orchestrator/src/execution/rpc/` или `tx-confirmation.service.ts`,
  новый worker.
- **review_required:** `backend-review`
- **depends_on:** P9-2 (pending row для poller)
- **status:** `proposed`

---

## P9-5 — Live slippage gate: реальный price-impact вместо tolerance

- **step_id:** `P9-5-LIVE-SLIPPAGE-GATE`
- **vector:** `SEC` (вторичный `FUNC`)
- **gate:** `live-blocker`
- **service:** `apps/execution-orchestrator`
- **goal:** Live risk-gate сейчас сравнивает slippage tolerance с собой же
  (`50 > 50` всегда false) → всегда проходит. Использовать реальный
  price-impact из `SlippageProtectionService.estimateSlippage`.
- **code-first verify (перед стартом):**
  - `uniswap-v2.adapter.ts:331-344` — `evaluateTrade({
    estimatedSlippageBps: getSlippageBps(args.slippageBps) })` где
    `getSlippageBps` возвращает tolerance (default 50).
  - `dex-risk-policy.service.ts:195` — `estimatedSlippageBps >
    config.maxSlippageBps` (оба 50) → false.
  - `slippage-protection.service.ts:65-71` — `estimateSlippage` считает реальный
    impact из reserves, но **не передаётся** в gate (используется только в
    plan-level `trade-cost-estimator.service.ts:245`).
  - `uniswap-v3.adapter.ts:508-531` — V3 fallback на stale
    `params.amountOutExpected` без max-age при Quoter failure.
- **approach:**
  1. В `enforceLiveRiskGate` adapter'ов вычислить реальный
     `priceImpactBps` через `SlippageProtectionService.estimateSlippage` (для V2
     из reserves, для V3 через Quoter).
  2. Передать `estimatedSlippageBps: priceImpactBps` в `evaluateTrade`.
  3. V3 fallback: при Quoter failure **fail-closed** (throw), либо max-age guard
     (если quote старше N секунд → throw). Не использовать stale
     detection-quote без guard.
  4. `amountOutMin` вычислять из свежего quote (не из tolerance).
  5. Integer-math fix в `slippage-protection.service.ts:65-71` — округление
     теряет precision (сейчас `Number(numerator / denominator)` truncates).
- **acceptance_criteria:**
  - `evaluateTrade` получает реальный price impact, не tolerance.
  - Тест: impact 60bps при maxSlippageBps=50 → trade **заблокирован**.
  - V3 Quoter failure → fail-closed (throw), не fallback на stale quote.
  - V3 с валидным свежим quote → `amountOutMin` корректный.
- **changed_areas:** `uniswap-v2.adapter.ts`, `uniswap-v3.adapter.ts`,
  `sushiswap-v2.adapter.ts`, `pancakeswap-v2.adapter.ts`, `biswap-v2.adapter.ts`,
  `slippage-protection.service.ts`, тесты.
- **review_required:** `dex-security`, `backend-review`
- **depends_on:** P9-1 (нужен confirmed OnChainTx для receipt verify в тестах)
- **status:** `proposed`

---

## P9-6 — ERC20 approve + swap с одного кошелька

- **step_id:** `P9-6-APPROVE-SWAP-WALLET`
- **vector:** `SEC`
- **gate:** `live-blocker`
- **service:** `apps/execution-orchestrator`
- **goal:** Approve и swap идут с разных кошельков (round-robin без token/amount
  vs с token/amount) → allowance всегда 0 → infinite loop или revert.
- **code-first verify (перед стартом):**
  - `apps/execution-orchestrator/src/execution/token/token-approve.service.ts:97`
    — `selectWallet(chainId, provider)` без token/amount args.
  - `uniswap-v2.adapter.ts` — adapter вызывает `selectWallet(chainId, provider,
    tokenIn, amountIn)` → может выбрать другой кошелёк.
- **approach:** Adapter передаёт уже выбранный `selectedWallet` (address +
  signer) в `approveToken`, либо `approveToken` принимает `walletAddress`
  параметр и использует конкретный signer. Approve и swap гарантированно с
  одного address.
- **acceptance_criteria:**
  - `allowance` читается и approve отправляется с того же address, что и swap.
  - Unit-тест: mock `selectWallet` → adapter + approve видят один address.
- **changed_areas:** `token-approve.service.ts`, adapters (подпись),
  `wallet-manager.service.ts` (если нужен `getWallet(address)` lookup).
- **review_required:** `dex-security`, `backend-review`
- **depends_on:** P9-3 (nonce lock покрывает approve тоже)
- **status:** `proposed`

---

## P9-7 — Reconciliation cron + stuck-plan reaper

- **step_id:** `P9-7-RECON-CRON-REAPER`
- **vector:** `REL`
- **gate:** `live-blocker`
- **service:** `apps/reconciliation-service`, `apps/execution-orchestrator`
- **goal:** (a) `runDetectors` сейчас только ручной триггер → расхождения сидят
  неделями. (b) Нет worker'а, детектящего застрявшие планы/legs → capital
  держится бесконечно.
- **code-first verify (перед стартом):**
  - `grep -rn "Cron\|Interval\|setInterval\|ScheduleModule" apps/reconciliation-service/src/`
    → пусто (подтверждено).
  - `apps/reconciliation-service/src/mismatches/mismatches.service.ts:74` —
    `runDetectors`; `mismatches.controller.ts:39` — `POST /mismatches/run-detectors`.
  - `apps/reconciliation-service/src/mismatches/mismatches.service.ts:127,149`
    — `LIMIT 10` per kind.
  - Нет reaper'а (пустой grep по `reaper|stuckPlan|legTimeout`).
- **approach:**
  1. **Reconciliation cron worker** в `reconciliation-service`: `setInterval`
     (как `PaperDiscoveryWorker` pattern — без `@nestjs/schedule`, `unref`/
     `clearInterval` в `onModuleDestroy`, метрики через
     `getArbibotMetricsRegistry()`). Интервал через env `RECON_DETECTOR_INTERVAL_MS`
     (default 60000). Вызывает `runDetectors`.
  2. **Stuck-plan reaper** в `execution-orchestrator` (т.к. ему принадлежат
     `ExecutionPlan`/`ExecutionLeg`): детектит legs в `submitting`/`sent`/
     `acknowledged` дольше `LEG_STUCK_TIMEOUT_MS` (default 300000 = 5 мин), планы
     в `armed`/`executing` дольше `PLAN_STUCK_TIMEOUT_MS` (default 1800000 = 30
     мин). Для `submitting` legs (после P9-1) — проверяет pending
     `OnChainTransaction`: если tx подтверждена on-chain → apply fill; если нет
     → помечает leg failed после retry-окна. Emit alert + audit.
  3. Raise `LIMIT 10` → `LIMIT 100` (или параметризовать); полагаться на
     `NOT EXISTS(open mismatch)` dedup для bounded backlog.
- **boundary constraint (BV1 — обязательная фиксация):** reaper в
  execution-orchestrator **не пишет напрямую** в `capital_reservations`
  (authoritative область capital-service, single-writer). Recovery-flow reaper'а:
  - leg/plan → terminal `failed` (через own `ExecutionLeg`/`ExecutionPlan`
    repos, execution-orchestrator owns их).
  - Capital release — **только через HTTP** к capital-service
    (`POST /capital/reservations/:id/release` или эквивалент существующего
    settlement path), не прямым SQL-write. Использовать settlement-relay (P9-8)
    либо явный HTTP-вызов. Прямой write = нарушение single-writer (REQUEST_CHANGES).
- **acceptance_criteria:**
  - `runDetectors` запускается автоматически каждые ~60с.
  - Застрявший leg (`submitting` > 5 мин) с подтверждённой on-chain tx → fill
    applied автоматически (через confirmation-poller P9-4).
  - Застрявший leg без tx → помечен failed; capital reservation released
    **через HTTP к capital-service** (BV1), не прямым write.
  - Метрики: `arb_reconciliation_run_total`, `arb_execution_stuck_leg_detected`,
    `arb_execution_stuck_plan_detected`.
  - Уведомление: stuck detection → Hermes alert (через существующий pipeline).
- **changed_areas:** `apps/reconciliation-service/src/mismatches/` (новый worker),
  `apps/execution-orchestrator/src/legs/` или `plans/` (reaper), тесты.
- **review_required:** `architecture` (single-writer boundaries — BV1 проверка),
  `backend-review`
- **depends_on:** P9-2 (OnChainTx для stuck-leg recovery), P9-1 (submitting
  state для reaper), **P9-4 (confirmation poller — SM2: reaper не может
  безопасно failed'нуть `submitting`-leg без проверки on-chain статуса pending
  tx; P9-4 должен быть готов до включения reaper-recovery для submitting)**.
  Заказ выполнения: P9-4 → P9-7 (для submitting-recovery); cron-часть
  reconciliation независима.
- **status:** `proposed`

---

## P9-8 — Settlement outbox relay (at-least-once delivery)

- **step_id:** `P9-8-SETTLEMENT-OUTBOX`
- **vector:** `REL` (вторичный `ARCH`)
- **gate:** `live-blocker`
- **service:** `apps/execution-orchestrator`
- **goal:** Settlement (portfolio confirm + capital release) сейчас post-commit
  HTTP с 4 retry, без persistence. Crash → portfolio-позиция отсутствует,
  capital не освобождён. Заменить на outbox-relay pattern (как в
  `opportunity-service`).
- **code-first verify (перед стартом):**
  - `apps/execution-orchestrator/src/legs/fill-outbound.service.ts:46-64` —
    `fetchWithRetry` (4 retries on 429/502/503/504) вне транзакции.
  - `fill-outbound.service.ts:73-101` — `afterLegFullyFilled`: plan-completion
    (atomic), потом optional `confirmPortfolio` + `releaseCapital` (HTTP).
  - `apps/opportunity-service/src/outbox-relay.service.ts:21-24` — референс
    pattern (relays `riskDecisionIssued`, `paperPromotionCandidateRequested`).
  - `legs.service.ts:690-700` — `legFilled` outbox row уже пишется; `plans.service.ts:281-291`
    — `planCompleted`. Но **ни один сервис их не drain'ит**.
- **approach:**
  1. Settlement действия (`confirmPortfolio`, `releaseCapital`) перенести в
     **outbox-relay worker**: читает unprocessed `legFilled`/`planCompleted`
     rows, делает HTTP-вызовы к portfolio/capital, помечает `processed_at`.
  2. **(B3 — обязательная фиксация)** Post-commit HTTP-путь в
     `fill-outbound.service.ts:73-101` (`afterLegFullyFilled` → `confirmPortfolio`
     + `releaseCapital` напрямую) **полностью удаляется** — не дублируется
     relay'ем. Допустимо **только один drain-point** (relay-worker), иначе
     double-delivery: и post-commit, и relay доставят settlement (даже при
     idempotency на принимающей стороне — это двойная нагрузка + race).
     `afterLegFullyFilled` после правки: только
     `tryMarkPlanCompletedWhenAllLegsFilled` (atomic, в tx) — всё остальное
     делегировано relay. `EXECUTION_SETTLEMENT_ENABLED` env остаётся kill-switch
     (когда `false` → relay не запускается, unit-тесты hermetic).
  3. На crash → worker resume с unprocessed rows (at-least-once; portfolio/
     capital уже idempotent via `idempotencyKey`).
  4. Plan-completion (`tryMarkPlanCompletedWhenAllLegsFilled`) остаётся
     synchronous-in-tx (atomic с leg state) — это не network call.
- **acceptance_criteria:**
  - Crash orchestrator между leg `filled` commit и portfolio POST → после
    restart worker доставляет settlement.
  - `processed_at` на outbox rows populated.
  - **(B3)** В `fill-outbound.service.ts` нет прямых HTTP-вызовов portfolio/
    capital из `afterLegFullyFilled` — только relay. Grep подтверждает один
    drain-point.
  - Idempotency: повторная обработка row (portfolio уже имеет позицию) → no-op.
  - Unit-тест: mock portfolio failure → relay retries; mock success after
    restart → delivered.
- **changed_areas:** `apps/execution-orchestrator/src/legs/fill-outbound.service.ts`,
  новый `settlement-relay.worker.ts` (или расширение существующего outbox
  pattern), тесты.
- **review_required:** `architecture` (outbox/inbox invariant), `backend-review`
- **depends_on:** —
- **status:** `proposed`

---

## P9-9 — Capital reservation idempotency (UNIQUE + sweeper)

- **step_id:** `P9-9-CAPITAL-IDEMPOTENCY`
- **vector:** `SEC`
- **gate:** `live-blocker`
- **service:** `apps/capital-service`
- **goal:** (a) Retry HTTP POST `/capital/reservations` → double-reservation
  (нет UNIQUE(correlation_id)). (b) Просроченные reservations бесконечно едят
  ceiling (expiry только lazy).
- **code-first verify (перед стартом):**
  - `infra/postgres/migrations/001_core.sql` — `capital_reservations` (LIVE)
    создана, **без UNIQUE(correlation_id)** (grep подтвердил только
    `paper_capital_reservations` имеет UNIQUE fix в `050`).
  - `packages/persistence/src/capital-reservation.entity.ts:8-33` — entity без
    unique constraint на correlationId.
  - `apps/capital-service/src/capital/capital.service.ts:70-164` — reserve()
    принимает correlationId, не проверяет существующий.
  - `capital.service.ts:176,206` — expiry только в `getById`/`release`.
- **approach:**
  1. **Migration `051_capital_reservation_correlation_unique.sql`:** partial
     unique index `WHERE state='active'` (как `050` для paper) — позволяет
     history expired/released rows.
  2. `reserve()` ловит PG unique violation (code 23505, pattern из
     `legs.service.ts:98-109`) → возвращает существующую reservation (idempotent).
  3. **Sweeper worker:** `setInterval` каждые 60s, `UPDATE capital_reservations
     SET state='expired' WHERE state='active' AND expires_at < NOW()`.
  4. Метрика `arb_capital_expired_reservations_total`.
- **acceptance_criteria:**
  - Два POST с одним `correlationId` → одна reservation (idempotent).
  - Просроченная reservation → expired в течение ~60с.
  - Migration idempotent (`IF NOT EXISTS`).
  - Unit-тест: concurrent reserve → one row; expired → sweeper clears.
- **changed_areas:** `infra/postgres/migrations/051_*.sql`,
  `apps/capital-service/src/capital/capital.service.ts`, новый sweeper worker,
  тесты.
- **review_required:** `architecture` (single-writer), `backend-review`
- **depends_on:** —
- **status:** `proposed`

---

## P9-10 — Vault salt runtime assert (fail-closed in production)

- **step_id:** `P9-10-VAULT-SALT-ASSERT`
- **vector:** `SEC`
- **gate:** `live-blocker`
- **service:** `packages/nest-platform` (vault)
- **goal:** `VAULT_MASTER_KEY_SALT` при отсутствии env тихо использует
  hardcoded `'arbibot-vault-salt-v1'` + warn. Runtime не fail-closes —
  атакующий с `wallet_keys` + `PRIVATE_KEY_ENCRYPTION_KEY` брутфорсит
  master-key (salt публичный в исходниках).
- **code-first verify (перед стартом):**
  - `packages/nest-platform/src/vault/key-vault.service.ts:93-101` —
    `const VAULT_SALT_FALLBACK = 'arbibot-vault-salt-v1'; const salt =
    process.env.VAULT_MASTER_KEY_SALT ?? VAULT_SALT_FALLBACK; if (salt ===
    FALLBACK) this.logger.warn(...)`.
  - `tools/validate-env.sh:156-163` — ловит только deploy-time.
- **approach:** В конструкторе `KeyVaultService` при
  `NODE_ENV === 'production' && !process.env.VAULT_MASTER_KEY_SALT` → **throw**
  (сервис не стартует). Для dev/test warn остаётся (backward-compat для
  существующих encrypted keys).
- **acceptance_criteria:**
  - `NODE_ENV=production` без `VAULT_MASTER_KEY_SALT` → сервис падает на старте
    с понятной ошибкой.
  - Dev/test без env → warn (как сейчас).
  - Unit-тест: `NODE_ENV=production` + missing salt → throw.
- **changed_areas:** `packages/nest-platform/src/vault/key-vault.service.ts`,
  тесты.
- **review_required:** `dex-security`, `backend-review`
- **depends_on:** —
- **status:** `proposed`

---

## P9-11 — Gas policy clamp (apply shouldReject/getCappedFeeData)

- **step_id:** `P9-11-GAS-POLICY-CLAMP`
- **vector:** `SEC` (вторичный `FUNC`)
- **gate:** `paper-check` (overspend, не capital loss)
- **service:** `apps/execution-orchestrator`
- **goal:** `shouldReject`/`getCappedFeeData` — dead code (0 callers).
  Priority-fee exceedance только warn, не ставит `withinPolicy=false`.
  Фактический `maxPriorityFeePerGas` в sendTransaction — uncapped.
- **code-first verify (перед стартом):**
  - `apps/execution-orchestrator/src/execution/gas/gas-estimator.service.ts:228-270`
    — `shouldReject`, `getCappedFeeData`.
  - `grep -rn "shouldReject\|getCappedFeeData" apps/ | grep -v spec` → только
    определения (0 callers, подтверждено).
  - `gas-estimator.service.ts:178-187` — priority-fee exceedance только warn.
  - `uniswap-v2.adapter.ts:485` — `if (!gasEstimation.withinPolicy) throw`.
  - `uniswap-v2.adapter.ts:498` — `maxPriorityFeePerGas` uncapped.
- **approach:**
  1. В `estimateGas`: если priority-fee exceedance → `withinPolicy=false` (не
     только warn).
  2. Adapter применяет `getCappedFeeData` к `feeData` перед `sendTransaction`
     (cap priority fee).
  3. Опционально: повторная проверка gas между estimate и send (если
     `rejectOnExceed`).
- **acceptance_criteria:**
  - Priority-fee выше cap → trade заблокирован (или capped).
  - `maxPriorityFeePerGas` в sendTransaction ≤ cap.
  - Unit-тест: mock gas spike → withinPolicy=false.
- **changed_areas:** `gas-estimator.service.ts`, adapters, тесты.
- **review_required:** `backend-review`
- **depends_on:** —
- **status:** `proposed`

---

## P9-12 — Ops prerequisites (wallet, RPC, capital env)

- **step_id:** `P9-12-OPS-PREREQ`
- **vector:** `DEVOPS` (вторичный `SEC`)
- **gate:** `live-blocker` (без этого live физически не запустится)
- **service:** operational (no code) — выполняет оператор + devops
- **goal:** Закрыть 3 операционных блокера из оценки Гермеса (валидных): 0
  ключей в БД, только public RPC, `CAPITAL_MAX_ACTIVE_USD=0`.
- **acceptance_criteria (checklist):**
  - [ ] `VAULT_MASTER_KEY_SALT` установлен в env (уникальный per-deploy).
  - [ ] Live-кошелёк создан, пополнен ETH/USDC на Arbitrum (минимальный капитал
        для smoke: $10-50; для observation: $100-200).
  - [ ] Ключ импортирован через `npm run wallet:import -- --key-id <id>
        --chain-id 42161 --expected-address 0x...` (P8-3 CLI).
  - [ ] Платный RPC (Alchemy/QuickNode) для Arbitrum mainnet, ≥2 провайдера
        (primary + backup) в `RPC_*` env. Public endpoints убраны из live config.
  - [ ] `CAPITAL_MAX_ACTIVE_USD` установлен (>0, начинать с консервативного
        $500-1000 для observation).
  - [ ] Дубликаты `capital.limits` в БД почищены (одна активная запись).
  - [ ] Testnet RPC URL для Arbitrum Sepolia настроен для smoke (P9-13).
- **changed_areas:** env config, DB seed cleanup — без кода.
- **review_required:** — (ops checklist, верифицируется `npm run verify:env`)
- **depends_on:** P9-10 (salt assert должен быть в коде first)
- **status:** `proposed`

---

## P9-13 — Single-chain Arbitrum smoke + crash/concurrency tests

- **step_id:** `P9-13-SINGLECHAIN-SMOKE`
- **vector:** `REL` (вторичный `DEVOPS`)
- **gate:** `live-blocker`
- **service:** `apps/execution-orchestrator`, tools
- **goal:** Существующий `tools/live-smoke-testnet.mjs` (P8-4) гоняет те же
  сломанные адаптеры — успешный smoke = ложная уверенность (урок
  `docs/lessons/hermes-agent-dod-failure.md`). Добавить targeted-тесты на
  crash/concurrency сценарии, которые выявили найденные баги.
- **code-first verify (перед стартом):**
  - `tools/live-smoke-testnet.mjs` — capital rehearsal + kill-drill + recon.
  - `apps/execution-orchestrator/src/execution/adapters/*.spec.ts` — 6 spec
    файлов, но покрывают happy-path, не crash/concurrency.
- **approach:**
  1. **Расширить `live-smoke-testnet.mjs`:** добавить single-chain Arbitrum
     сценарий (USDC/WETH пара на UniV2/V3), end-to-end от opportunity →
     execution → settlement → portfolio → recon.
  2. **Crash-mid-submit тест** (unit/integration): mock процесс-килл после
     Phase 1 commit (P9-1), до/во время Phase 2 → reaper (P9-7) восстанавливает.
  3. **Concurrency тест:** 2+ legs одного плана на одном кошельке → nonce
     уникальны (P9-3).
  4. **Slippage-block тест:** mock price impact > maxSlippage → trade blocked
     (P9-5).
  5. **Settlement-resume тест:** mock portfolio failure post-commit → relay
     (P9-8) delivers после restart.
  6. **CI job** `e2e-singlechain-live-readiness` (Postgres + execution-orchestrator
     + capital + portfolio + reconciliation, mock RPC).
- **acceptance_criteria:**
  - Smoke проходит на Arbitrum Sepolia с реальным testnet tx (kill-drill +
    capital rehearsal из P8-4).
  - Crash/concurrency/slippage/settlement targeted-тесты green.
  - CI job `e2e-singlechain-live-readiness` добавлен в
    `.github/workflows/ci.yml`.
- **changed_areas:** `tools/live-smoke-testnet.mjs` (расширение), новые spec
  файлы, `tools/ci-e2e-singlechain-live-readiness.sh`,
  `.github/workflows/ci.yml`, `package.json` (scripts).
- **review_required:** `backend-review`
- **depends_on:** P9-1, P9-2, P9-3, P9-5, P9-7, P9-8 (все кодовые блокеры)
- **status:** `proposed`

---

## P9-gate (DoD)

План считается выполненным, когда **все** условия соблюдены:

1. **Все 13 шагов** `status: done` (code + docs).
2. **CI green:** `build` 22+/22+, `lint` 29+/29+, `execution-orchestrator` tests
   (расширенные) green, новый `e2e-singlechain-live-readiness` green.
3. **Архитектурные инварианты** (verified `/architecture-guard`):
   - single-writer на `on_chain_transactions` = execution-orchestrator (only).
   - reservation-first не обойдён (capital всё ещё резервируется до execution).
   - outbox/inbox: settlement теперь at-least-once (не post-commit fire-and-forget).
   - paper/live изоляция: bridge venue keys остаются halt'нутыми (Plan 10).
4. **Capital safety** (verified `/dex-security`): broadcast не внутри DB-tx;
   crash между broadcast и commit → reaper восстанавливает; nonce гонки нет.
5. **Документы обновлены** (принцип P2):
   - [`docs/roadmap-vectors.md`](../../docs/roadmap-vectors.md) — инициативы
     #24-#34 добавлены в реестр, статус `done`.
   - [`AGENTS.md`](../../AGENTS.md) — блок Plan 9 + current status.
   - Новый ADR: `docs/adr-p9-broadcast-idempotency.md` (two-phase mark-sent,
     `submitting` state).
   - [`docs/live-deploy-dod.md`](../../docs/live-deploy-dod.md) — обновлён с
     reference на P9 single-chain gate.
6. **Single-chain Arbitrum smoke** на Sepolia passed (P9-13).

После P9-gate: валидно включить `DEX_VENUE_ENABLED=true` для Arbitrum single-chain
с минимальным капиталом, под наблюдением 24ч (фазы 5-6 из оценки Гермеса —
*теперь* безопасны на починенном коде).

---

## Маппинг на реестр инициатив roadmap-vectors.md

> Будет добавлено в `docs/roadmap-vectors.md` §5 (реестр) при старте плана.

| # | step_id | Вектор(ы) | gate | impact | effort | score | status | plan |
|---|---------|-----------|------|--------|--------|-------|--------|------|
| 24 | `SEC-BROADCAST-IDEMPOTENCY` | SEC (REL) | live-blocker | 5 | 4 | 10 | accepted | PLAN9 (`P9-1`) |
| 25 | `REL-ONCHAIN-TX-PERSIST` | REL (SEC) | live-blocker | 5 | 3 | 15 | accepted | PLAN9 (`P9-2`) |
| 26 | `SEC-NONCE-LOCK` | SEC (FUNC) | live-blocker | 5 | 3 | 15 | accepted | PLAN9 (`P9-3`) |
| 27 | `REL-TXWAIT-TIMEOUT` | REL (SEC) | live-blocker | 4 | 2 | 16 | accepted | PLAN9 (`P9-4`) |
| 28 | `SEC-LIVE-SLIPPAGE-GATE` | SEC (FUNC) | live-blocker | 5 | 3 | 15 | accepted | PLAN9 (`P9-5`) |
| 29 | `SEC-APPROVE-SWAP-WALLET` | SEC | live-blocker | 4 | 2 | 16 | accepted | PLAN9 (`P9-6`) |
| 30 | `REL-RECON-CRON-REAPER` | REL | live-blocker | 5 | 3 | 15 | accepted | PLAN9 (`P9-7`) |
| 31 | `REL-SETTLEMENT-OUTBOX` | REL (ARCH) | live-blocker | 4 | 4 | 8 | accepted | PLAN9 (`P9-8`) |
| 32 | `SEC-CAPITAL-IDEMPOTENCY` | SEC | live-blocker | 3 | 2 | 12 | accepted | PLAN9 (`P9-9`) |
| 33 | `SEC-VAULT-SALT-ASSERT` | SEC | live-blocker | 3 | 1 | 15 | accepted | PLAN9 (`P9-10`) |
| 34 | `SEC-GAS-POLICY-CLAMP` | SEC (FUNC) | paper-check | 3 | 2 | 12 | accepted | PLAN9 (`P9-11`) |

> P9-12 (ops) и P9-13 (smoke) — не кодовые инициативы, в реестр не вносятся
> (по P5: реестр не дублирует операционный трекер).

---

## Связь с оценкой Гермеса (2026-08-03)

| Аспект | Вердикт Гермеса | Что говорит код | Покрытие Plan 9 |
|--------|-----------------|-----------------|-----------------|
| Kill Switch / Live Gate | ✅ READY | 🟡 Механизм есть, blind-spot ~12с | out of scope (minor) |
| Wallet / Keys | ❌ NOT READY | ✅ Валидно (0 ключей, нет salt) | **P9-10, P9-12** |
| DEX Adapters | ✅ READY | ❌ НЕ READY (slippage, nonce, OnChainTx) | **P9-1…P9-6** |
| RPC Providers | ❌ NOT READY | ✅ Валидно | **P9-12** |
| Capital | ⚠️ PARTIAL | 🟡 Валидно + доп.: нет UNIQUE, sweeper | **P9-9, P9-12** |
| Risk | ✅ READY | ❌ НЕ READY (slippage gate вакуумный) | **P9-5** |
| Bridge | ✅ READY | ❌ НЕ READY (неверные адреса, fake ABI) | **PLAN10** (out of scope) |
| Monitoring/Alerts | ⚠️ PARTIAL | 🟡 Валидно + доп.: recon нет cron | **P9-7** |
| Backup/Recovery | ✅ READY | ✅ Валидно | — |
| Testing | ⚠️ PARTIAL | 🟡 Недооценено (smoke не ловит баги) | **P9-13** |

**Итог:** оценка Гермеса «~75% готовности» верна для **операционки** (кошелёк,
RPC, env), но **завышена для кода**. Plan 9 закрывает кодовый разрыв (~20-25%
готовности, которые Гермес простамповал как ✅). После Plan 9 реальная
готовность к single-chain Arbitrum live — ~95%; оставшиеся 5% = cross-chain
(Plan 10) + operações decision.
