# Threat Model — DEX & Capital Safety

Детальные exploit-сценарии и примеры remediation для каждой строки threat matrix в `SKILL.md`.
Загружается только при глубоком аудите RED-зон. Не дублирует checklists — раскрывает **почему**.

## K1 — Утечка приватного ключа (🔴 critical)

**Exploit-сценарий:**
1. Разработчик добавляет `Logger.debug('signing with wallet', wallet)` для отладки DEX leg.
2. В staging/проде лог агрегируется (Loki/CloudWatch) с retention 90 дней.
3. Лог читает любой, у кого есть read-доступ к logs — ops, on-call, иногда auditor.
4. Private key утёк → атакующий может подписать произвольную tx с кошелька с капиталом.

**Где проявляется в Arbibot 2:**
- `KeyVaultService.decrypt` → возвращённый signer используется в calling code. Любой лог между decrypt и broadcast уязвим.
- Error responses: Fastify по умолчанию может включать stack; если stack содержит wallet object — утечка.
- `wallet_states` migration `033`: если в БД случайно пишется plaintext (не через KeyVaultService) — ключ в БД.

**Remediation:**
- Логировать только fingerprint ключа (`keccak256(publicKey).slice(0,8)`), никогда сам ключ.
- Fastify error handler в проде: `{ statusCode, error, message }`, без `stack`.
- Secret scanning в CI (Trivy уже есть) + pre-commit hook на паттерны private key (`0x` + 64 hex, `gitcoin`, `mnemonic`).
- Использовать allowlist полей для логов: `{ legId, chainId, amount, token }`, не весь объект.

**Verification:**
```bash
# Grep-доказательство отсутствия утечки
grep -rn "privateKey\|mnemonic\|\.privateKey\|wallet\.signingKey" apps/ packages/ \
  --include="*.ts" | grep -v "test\|spec\|mock" | grep -vi "comment\|\\*"
```
Должен вернуть пустоту или только whitelist-комментарии.

---

## K2 — Расшифровка ключа вне vault (🔴 critical)

**Exploit-сценарий:**
1. Calling code вызывает `KeyVaultService.decrypt(keyId)` и получает raw key string.
2. Raw key сохраняется в локальную переменную с долгим lifetime (поле класса, closure).
3. Heap dump / core dump / GC delay раскрывает key в памяти.

**Где проявляется:**
- `WalletManagerService.getEncryptedKey` делегирует к `KeyVaultService` — но если calling code `WalletManagerService` дальше хранит decrypted key в поле — нарушение K2.
- Audit-цель: если кто-то добавляет «read key for audit» путь без operator approval — обход.

**Remediation:**
- Pattern: `KeyVaultService` возвращает готовый `ethers.Wallet` (signer), не raw key. Calling code никогда не видит plaintext.
- Если plaintext неизбежен — scope в функцию, нуллифицируй сразу после использования.
- Запретить `decrypt`-for-read-без-sign path: если key запрашивается, но не для sign — alarm.

---

## T1 — Replay on-chain tx (🔴 critical)

**Exploit-сценарий:**
1. Execution orchestrator параллельно подписывает 2 legs одним кошельком.
2. Обе берут nonce через `getTransactionCount('pending')` одновременно → одинаковый nonce.
3. Одна tx mined, вторая dropped OR обе submitted → одна заменяет другую (ребёнок потерян).

**Альтернативный сценарий:**
- OnChainTransaction с тем же `legId` обрабатывается дважды (retry / outbox redelivery) → второй submit списывает средства дважды.

**Где проявляется:**
- `on_chain_transactions` (migration `033`): если `txHash` не unique-constraint по `legId` → дубль.
- Parallel leg signing в `MultiLegPlanBuilder`: общий wallet → гонка nonce.

**Remediation:**
- Local nonce tracker с optimistic lock: increment atomic, retry при conflict.
- Unique constraint: `on_chain_transactions(leg_id)` partial unique WHERE status != 'failed'.
- Идемпотентность: idempotencyKey на submit, проверка существующей tx по `legId` до повторного submit.

---

## T2 — Front-running / sandwich (🟠 high)

**Exploit-сценарий:**
1. Arb opportunity: купить на DEX A, продать на DEX B. Разница 0.5%.
2. Tx в публичный mempool видна MEV-боту.
3. Бот front-runs покупку (поднимает цену) + back-runs продажу → arb убыточен.

**Где проявляется:**
- execution-orchestrator broadcast: если идёт через публичный RPC без private mempool — уязвимость.
- Крупные swaps особенно уязвимы (видимый размер в mempool).

**Remediation:**
- Private mempool / Flashbots protect (Arbitrum: Flashbots-style, Base: protecting RPC).
- Документировать как known risk если private mempool недоступен.
- Разделять broadcast-стратегию по chain (у каждой L2 свой защищённый путь).
- Slippage protection (T3) как second line of defense.

---

## T3 — Slippage / price impact (🟠 high)

**Exploit-сценарий:**
1. Swap без `minimumAmountOut` (или с `0`).
2. В момент tx в блоке цена сместилась → получено на 5% меньше ожидаемого.
3. Arb превращается в убыток, capital списан.

**Где проявляется:**
- `SlippageProtectionService`: если tolerance жёстко задан 1% для всех tiers — на low-liquidity pool этого мало.
- `MultiLegPlanBuilder`: если каждый leg считает slippage отдельно, но не кумулятивно — недооценка.

**Remediation:**
- Tolerance по liquidity tier (migration `015` token/route profiles).
- Кумулятивный slippage для multi-leg: суммарный tolerance < ожидаемой маржи.
- `deadline` параметр (обычно `block.timestamp + 120s`): tx не mine'ится после истечения.
- Block на уровне `SlippageProtectionService`: tolerance > маржи → reject с DEX-reason code.

---

## T4 — Integer overflow (🟠 high)

**Exploit-сценарий:**
1. Amount = `1e18 * 1e18` (произведение в AMM расчёте) в JS `number` → `Infinity` или precision loss.
2. `minimumAmountOut` посчитан неверно → swap без реальной защиты.
3. Или: amount rounding в пользу атакующего.

**Где проявляется:**
- Любой AMM math в TS: `amountIn * priceB`, `reserveIn * reserveOut`, `getAmountOut`.
- `MultiLegPlanBuilder` расчёт leg amounts.

**Remediation:**
- `bigint` везде для on-chain amounts (decimals 18).
- Solidity-контракты: версия ≥ 0.8 (checked arithmetic встроен).
- Тесты на граничных значениях: `MAX_UINT256`, `0`, `1`, `1e30`.
- Не использовать `Number` для любых расчётов с token amounts.

---

## B1 — Bridge replay / double-spend (🔴 critical)

**Exploit-сценарий:**
1. Bridge transfer Across L2→L1 initiated, `bridge_transfers` row created.
2. Polling worker падает, restart, reprocesses same transfer (no idempotency on bridge ID).
3. Вторая инициированная bridge tx → double transfer капитала.

**Альтернативный сценарий:**
- Bridge message replay на стороне получателя (если нет nonce/message-id dedup).

**Где проявляется:**
- `BridgeTransferService`: если `bridgeMessageId` / `transferId` не unique-constraint → дубль.
- Adapter-side: Across/Stargate message id не проверяется на duplicate claim.

**Remediation:**
- `bridge_transfers` unique constraint на bridge-protocol message id.
- Adapter: check `isAlreadyClaimed(messageId)` перед claim.
- Idempotency на polling: track last-processed block per bridge, не reprocess.

---

## B2 — Bridge timeout без rollback (🟠 high)

**Exploit-сценарий:**
1. Bridge transfer initiated, но L1 finality задержалась (7+ дней на Optimism-native bridge).
2. `BridgeTransferPollingWorker` крутит бесконечно, капитал завис.
3. ExecutionPlan в `executing` forever, operator не знает что делать.

**Где проявляется:**
- `BridgeTransferPollingWorker`: если timeout detection отсутствует → silent hang.
- `docs/dex-runbook-bridge.md`: если manual recovery не задокументирован → operator paralysed.

**Remediation:**
- Timeout per bridge protocol (Across ~min, native L2 ~7 days).
- Timeout → transfer status `timed_out` → operator notification.
- Runbook: шаги для manual claim / refund / unwind.

---

## B3 — Ложная финальность (🟠 high)

**Exploit-сценарий:**
1. Bridge adapter использует `confirmations = 6` для всех chain.
2. Для Optimism L1 finality — это ~1 epoch, может быть reorg.
3. Transfer помечен `completed` преждевременно → позиция закрыта, но bridge reverted.

**Где проявляется:**
- Adapter config: общий `confirmations` default для всех chain.
- Reorg handling: если chain reorg'нул после `completed` — нет invalidation.

**Remediation:**
- Chain-specific thresholds: Ethereum 12 confirmations, Optimism 2000+ blocks, Arbitrum final, BNB 15.
- Reorg detection: monitor chain head, invalidate transfers ниже finality.

---

## C1 — Capital exposure > лимита (🔴 critical)

**Exploit-сценарий:**
1. Несколько ExecutionPlans активны параллельно, каждый резервирует капитал.
2. Нет глобального max-exposure guard.
3. Сумма reservations > доступного капитала → insolvency.

**Где проявляется:**
- `capital-service` + `dex.limits`: если нет atomic check сумма активных reservations vs ceiling.
- Race: 2 plan'а резервируют одновременно, оба проходят check, сумма превышает.

**Remediation:**
- Atomic capital check: `SELECT ... FOR UPDATE` на capital record во время reservation.
- `dex.limits`: max-exposure per chain, per token, per route — enforced в `DexRiskPolicyService`.
- Reservation-first: ни один leg без `CapitalReservation` active.

---

## C2 — Kill-switch не enforced (🔴 critical)

**Exploit-сценарий:**
1. Operator включает safe-mode через HERMES UI.
2. UI помечает режим "safe", но execution-orchestrator продолжает принимать новые plans.
3. Во время инцидента капитал продолжает тратиться.

**Где проявляется:**
- Если `enable_safe_mode` только обновляет UI-флаг, но orchestrator не проверяет флаг при `arm` → hole.
- In-flight legs: safe-mode не останавливает уже executing legs.

**Remediation:**
- Enforcement layer: orchestrator `arm()` проверяет safe-mode status перед proceed.
- In-flight: safe-mode → pause/abort executing legs (с compensating flow).
- Test: explicit test "safe-mode blocks live ExecutionPlan creation".

---

## C3 — Paper/live contamination (🔴 critical)

**Exploit-сценарий:**
1. Разработчик добавляет в `paper-trading-service` импорт `WalletManagerService` "для удобства тестирования".
2. Paper path случайно вызывает live wallet sign → реальные средства задействованы.
3. Paper validation больше не валидный, capital at risk.

**Где проявляется:**
- `apps/paper-trading-service/src/`: любой импорт из `@arbibot/capital-service`, `@arbibot/execution-orchestrator` wallet module.
- Shared entity: если `PaperCapitalReservation` и `CapitalReservation` используют общую таблицу или общий wallet entity.

**Remediation:**
- Import-graph проверка в CI: banned imports в paper-trading-service.
- Bounded context: paper wallet ≠ live wallet (разные entities, разные services).
- Config: `dex.live` ≠ paper config, нет общего mutable state.

**Verification:**
```bash
grep -rn "capital-service\|execution-orchestrator\|WalletManager\|KeyVault" \
  apps/paper-trading-service/src/ --include="*.ts" | grep -v "test\|spec\|mock"
```
Должен вернуть пустоту.

---

## A1/A2 — Token approval leakage (🟡 medium)

**Exploit-сценарий:**
1. `approve(MAX_UINT256)` на DEX router "чтобы не делать approve каждый раз".
2. Router скомпрометирован (bug / exploit) → весь баланс токена списан.
3. Или: allowance завис после leg, новый exploit vector.

**Где проявляется:**
- `TokenApproveService`: если default — MAX_UINT256 без revoke.
- `approvals` table: если не обновляется после revoke → stale allowance cache.

**Remediation:**
- Default: approve точный amount для leg.
- После completed/failed/canceled leg: `decreaseAllowance(0)` или `revoke`.
- `approvals` table: TTL cache, refresh после revoke, alert если on-chain ≠ cache.
