# D4-C-3-PANIC — Единая «красная кнопка» (panic-button)

| Поле | Значение |
|------|----------|
| **depends_on** | `D4-B-1-KILLSWITCH` |
| **risk_level** | `medium` |
| **estimated_hours** | 4 |
| **status** | `done` |

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
- [x] `npm run panic:stop` атомарно останавливает trading (DEX_LIVE_KILL_SWITCH + PAPER_DISCOVERY_ENABLED + RISK_POLICY_JOBS_ENABLED, restart сервисов, audit)
- [x] Все affected сервисы перечитывают kill-switch после restart (docker compose restart execution-orchestrator paper-trading-service risk-service)
- [x] Audit-запись о panic-event (PANIC_BUTTON_TRIGGERED / PANIC_BUTTON_RECOVERED через audit-service POST /audit/entries)
- [x] Operator UI кнопка дублирует скрипт (PanicButton в layout, BFF /api/operator/system/panic-stop + panic-recover, backend POST /policy/system/panic-* в config-service)
- [x] Recovery требует typed-confirm (НЕ single-click): CLI `--confirm "I UNDERSTAND THIS RESUMES TRADING"` + UI typed phrase + backend enforce
- [x] Документация в incident-response-playbook §4.1 (panic-button как первое действие SEV-1/SEV-2 + таблица kill-switches с backend-enforcement статусом + TODO для PAPER_DEX_MAINNET_ENABLED)
- [x] hermes-safe-mode-runbook обновлён (safe-mode = signal, panic-button = action)

## Implementation notes
- **CLI:** `tools/panic-button.sh` (flip + restart + audit, flock optional для race protection, --dry-run для теста), `tools/panic-recover.sh` (typed-confirm gate). npm scripts `panic:stop` / `panic:recover`.
- **Backend:** `PanicController` + `PanicService` в config-service — flip'ает `dex.limits.killSwitch` через single-writer `ConfigurationsService.update` + audit. Не flip'ает env-read flags (paper-discovery, risk-jobs) — для них CLI.
- **BFF:** `/api/operator/system/panic-stop` + `/api/operator/system/panic-recover` (operator role, inject operatorId).
- **UI:** `PanicButton` (client component) в `(operator)/layout.tsx` — bottom-right sticky, operator/admin only. Typed-phrase gate для stop (PANIC) и recover (I UNDERSTAND THIS RESUMES TRADING).
- **Adaptation из-за дескоупа D4-B-8:** recovery через typed-confirm + audit вместо two-person. Документировано в ADR и playbook.
- **PAPER_DEX_MAINNET_ENABLED** — документирован, но не реализован ни в одном сервисе. Panic-script НЕ flip'ает его (честность > имитация). TODO в playbook §4.2.
- **Тесты:** dry-run panic + recover (both exit 0); recover без confirm exit 1; build 22/22 ✅, lint clean (web: 0 errors, 2 pre-existing warnings в paper-trades-table).

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
