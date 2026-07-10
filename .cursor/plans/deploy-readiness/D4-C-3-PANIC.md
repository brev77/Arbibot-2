# D4-C-3-PANIC — Единая «красная кнопка» (panic-button)

| Поле | Значение |
|------|----------|
| **depends_on** | `D4-B-1-KILLSWITCH` |
| **risk_level** | `medium` |
| **estimated_hours** | 4 |
| **status** | `planned` |

## Контекст (из ревью)
Safe-mode HERMES (`apps/hermes-gateway/src/hermes/safe-mode.service.ts`) — **баннер-сигнал, не тормоз** (`docs/hermes-safe-mode-runbook.md:18`: «does not automatically halt execution or capital services»). Экстренная остановка = многошаговое редактирование `.env` kill-switch'ей + `docker compose restart` (P6). Нет единого panic-button.

## Outputs
1. **`tools/panic-button.sh`** — единый скрипт emergency-stop:
   - Атомарно устанавливает ВСЕ kill-switches одним действием:
     - `DEX_LIVE_KILL_SWITCH=true` (после D4-B-1 — backend читает)
     - `PAPER_DEX_MAINNET_ENABLED=false`
     - `PAPER_DISCOVERY_ENABLED=false`
     - `RISK_POLICY_JOBS_ENABLED=false`
   - Перезапускает affected сервисы (`docker compose restart execution-orchestrator paper-trading-service market-intake`)
   - Записывает audit entry (через audit-service API или direkt в БД)
   - Логирует событие в Slack/PagerDuty (через alertmanager или webhook)
2. **`package.json`** — `panic:stop` скрипт: `bash tools/panic-button.sh`
3. **Operator UI** — кнопка «EMERGENCY STOP» в `/incidents` (или top-bar), вызывающая backend endpoint, который выполняет тот же набор kill-switch flips через config-service mutations + restart trigger
4. **`docs/incident-response-playbook.md`** — обновить: panic-button как первый шаг SEV-1/SEV-2
5. **Recovery procedure** — `tools/panic-recover.sh` (обратный, требует two-person approval — D4-B-8)

## Acceptance
- [ ] `npm run panic:stop` атомарно останавливает trading (live + paper discovery)
- [ ] Все affected сервисы перечитывают kill-switch после restart
- [ ] Audit-запись о panic-event
- [ ] Operator UI кнопка дублирует скрипт
- [ ] Recovery требует two-person (не single-click un-panic)
- [ ] Документация в incident-response playbook

## Edge Cases
- Panic во время in-flight bridge transfer (нельзя отменить on-chain) → документировать: panic останавливает NEW trades, in-flight довыполнить через reconciliation
- Race: panic + параллельный operator restart → скрипт должен брать lock (flock)
- False panic → recovery через two-person (D4-B-8)

## Test Commands
```bash
# На dev-стеке (не прод!)
npm run panic:stop
# Проверить, что сервисы перечитали kill-switch
docker compose logs execution-orchestrator | tail -20
```

## Rollback
`git checkout -- package.json docs/incident-response-playbook.md` + `rm tools/panic-button.sh tools/panic-recover.sh` + убрать UI кнопку
