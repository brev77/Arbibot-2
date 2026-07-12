# D4-B-5-BRIDGE — Confirmation/finality логика в bridge-адаптерах

| Поле | Значение |
|------|----------|
| **depends_on** | `D4-B-0-LIVE-ADR` |
| **risk_level** | `high` |
| **estimated_hours** | 10 |
| **status** | `planned` |

## Контекст (из ревью)
`grep -rn "\.wait(\|confirmations\|receipt" apps/execution-orchestrator/src/execution/bridge/*.adapter.ts` → **пусто**. В `across-bridge.adapter.ts`, `native-bridge.adapter.ts`, `stargate-bridge.adapter.ts` нет ожидания финальности/реceipt'а. Защиты **B1** (idempotent claim) и **B3** (chain-specific finality, напр. Ethereum 12, Optimism 2000+) задокументированы в `docs/dex-runbook-bridge.md`, но **не реализованы** (L5).

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
- [ ] Каждый adapter ждёт confirmations перед переходом в `completed`
- [ ] Chain-specific thresholds применяются (Ethereum 12, Optimism 2000+)
- [ ] Timeout → `timed_out` статус, не висит в `confirming` вечно
- [ ] Idempotent claim: повторный broadcast того же leg не создаёт дубль
- [ ] Юнит-тесты с мок-провайдером: success/timeout/confirmations
- [ ] Интеграционный тест с testnet (по возможности)

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
