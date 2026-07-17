# D4-B-5-BRIDGE — Confirmation/finality логика в bridge-адаптерах

| Поле | Значение |
|------|----------|
| **depends_on** | `D4-B-0-LIVE-ADR` |
| **risk_level** | `high` |
| **estimated_hours** | 10 |
| **status** | `done` |

## Контекст (из ревью)
~~`grep -rn "\.wait(\|confirmations\|receipt" apps/execution-orchestrator/src/execution/bridge/*.adapter.ts` → **пусто**.~~ **Реализовано в D4-B-5-BRIDGE:** `BridgeFinalityService` (`apps/execution-orchestrator/src/execution/bridge/bridge-finality.service.ts`) + миграция `043_bridge_finality.sql` (колонки finality на `bridge_transfers`). Все 3 адаптера (across, native, stargate) вызывают `waitForFinality` после broadcast. Коммиты: `ae8dd9f` (execution), `6623350` (contracts), `ba77f78` (infra/migration), `032f0a5` (docs). Защиты **B1** (idempotent claim) и **B3** (chain-specific finality) реализованы и описаны в `docs/dex-runbook-bridge.md`.

## Outputs
1. **`apps/execution-orchestrator/src/execution/bridge/bridge-finality.service.ts`** — сервис ожидания финальности:
   - Chain-specific `confirmations` thresholds (конфиг): Ethereum 12, Arbitrum ~instant (но dispute-window), Optimism 2000+, Base, BNB
   - `waitForFinality(txHash, chainId): Promise<Receipt>` → `provider.waitForTransaction(txHash, confirmations)` с таймаутом
2. **Каждый adapter** (`across`, `native`, `stargate`) — после broadcast bridge-tx:
   - Записать `txHash` в `bridge_transfers` (существующая таблица из миграции 036)
   - Вызвать `waitForFinality` → обновить статус `pending → confirming → completed`
   - При timeout → `timed_out` (state machine уже описан в runbook)
3. **Idempotent claim (B1):** ключ `planId:legIndex:bridgeKey` (документирован в runbook:52) — проверить на наличие существующего pending transfer перед повторным broadcast
4. **`CrossChainReconciliationWorker`** — уже есть, проверить, что он детектит `confirming`-зависшие (timeout)
5. Обновить `docs/dex-runbook-bridge.md` — привести state machine в соответствие с кодом

## Acceptance
- [x] Каждый adapter ждёт confirmations перед переходом в `completed` — `BridgeFinalityService.waitForFinality` вызывается из всех 3 адаптеров
- [x] Chain-specific thresholds применяются (Ethereum 12, Optimism 2000+) — constants в `@arbibot/contracts-eth` + `BridgeFinalityService`
- [x] Timeout → `timed_out` статус, не висит в `confirming` вечно — `bridge-transfer.service.ts` переводит в `TIMED_OUT`
- [x] Idempotent claim: повторный broadcast того же leg не создаёт дубль — `bridge-transfer.service.ts` idempotency key `planId:legIndex:bridgeKey`
- [x] Юнит-тесты с мок-провайдером: success/timeout/confirmations — `bridge-finality.service.spec.ts`, `bridge-transfer.service.spec.ts`, `across/native/stargate-bridge.adapter.spec.ts`
- [ ] Интеграционный тест с testnet (по возможности) — отложено до D4-C-4-LIVE-SMOKE (live testnet soak, заблокировано по product decision)

## Edge Cases
- Reorg после confirmations → теоретически возможен на L1; document, не блокировать
- Chain halt → timeout срабатывает, оператор triage
- Gas-spike → retry с bump fee (отдельная задача, можно backlog)
- Testnet vs mainnet thresholds → конфиг per-environment

## Test Commands
```bash
npm run test -w @arbibot/execution-orchestrator
npm run build -w @arbibot/execution-orchestrator
```

## Rollback
`git checkout -- apps/execution-orchestrator/src/execution/bridge/ docs/dex-runbook-bridge.md` + удалить `bridge-finality.service.ts`
