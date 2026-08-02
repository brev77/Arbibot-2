# Live-testnet smoke runbook (P8-4)

> **Сквозной smoke для DoD Gate 3** ([`docs/live-deploy-dod.md`](live-deploy-dod.md) §Gate 3).
> Инструмент: `npm run smoke:live-testnet` (`tools/live-smoke-testnet.mjs`).

## Назначение

До P8-4 не было end-to-end smoke, который проверяет **capital rehearsal + kill-switch drill + reconciliation** в одном прогоне. `e2e-dex1-testnet.mjs` тестирует adapter-level trade execution, а не gates. Этот smoke фокусируется на **gates** — тех самых защитах, которые должны сработать до/во время/после live-трейда.

## Что покрывает (4 фазы)

| Фаза | Что проверяет | DoD Gate 3 пункт |
|------|--------------|------------------|
| **HEALTH** | execution-orchestrator, capital-service, reconciliation-service, opportunity-service отвечают; (testnet) DEX health ok | prerequisites |
| **CAPITAL** | `POST /capital/reservations` под aggregate ceiling gate (D4-B-3); reserve → release cleanup | Capital rehearsal (≤ $10) |
| **KILLDRILL** | `panic:stop` → verify `arb_dex_live_halt_active=1` → `panic:recover` → verify `=0` | Kill-switch drill mid-soak |
| **RECON** | `GET /mismatches?status=open` → 0 open post-smoke | Reconciliation (0 mismatches) |

**Что НЕ покрывает (отдельный long-run):**
- Paper→live bridge transfers (≥10) — это soak на 24h, не single-run smoke. Используйте `e2e:dex2-multichain` для adapter-level, и отдельный 24h soak для 10 bridges.
- Real testnet trade execution — делегировано в `e2e-dex1-testnet.mjs --testnet`. Этот smoke фокусируется на gates.

## Prerequisites

1. **P8-2(d)** применён: Arbitrum Sepolia chain-id = `421614` (иначе testnet-RPC ходит не туда).
2. Запущены сервисы: execution-orchestrator (3012), capital-service (3011), reconciliation-service (3017), opportunity-service (3010).
3. Для `--testnet` mode:
   - `DEX_VENUE_ENABLED=true` на execution-orchestrator.
   - Wallet keys импортированы (`npm run wallet:import`, P8-3).
   - RPC testnet URLs настроены (`RPC_ARBITRUM_TESTNET_URL` и т.д.).
   - Kill-switch OFF (`DEX_LIVE_KILL_SWITCH=false`, `dex.limits.killSwitch=false`).
   - Testnet capital на кошельке (для ≤ $10 rehearsal).

## Запуск

```bash
# Dry-run (paper, no real tx, no wallet needed) — проверяет gates:
npm run smoke:live-testnet

# Testnet (real tx ≤ $10):
SMOKE_CAPITAL_USD=1 npm run smoke:live-testnet -- --testnet

# CI-friendly (skip kill-switch drill — panic/recover требует restart сервисов):
SMOKE_SKIP_KILLDRILL=true npm run smoke:live-testnet
```

### Параметры (env)

| Env | Default | Описание |
|-----|---------|----------|
| `SMOKE_CAPITAL_USD` | `1` | Capital rehearsal budget. **Fail-closed at $10** (DoD Gate 3: ≤ $10). |
| `SMOKE_SKIP_KILLDRILL` | — | `true` = skip kill-switch drill (CI-friendly; panic/recover требует restart). |
| `SMOKE_TIMEOUT_MS` | `30000` | Per-request timeout. |
| `EXECUTION_API_BASE` | `http://127.0.0.1:3012` | execution-orchestrator URL. |
| `CAPITAL_API_BASE` | `http://127.0.0.1:3011` | capital-service URL. |
| `RECONCILIATION_API_BASE` | `http://127.0.0.1:3017` | reconciliation-service URL. |
| `OPPORTUNITY_API_BASE` | `http://127.0.0.1:3010` | opportunity-service URL. |

### Exit codes

- `0` — smoke passed (все gates работают).
- `1` — assertion/health failure (сервис недоступен, reconciliation dirty, и т.п.).
- `2` — capital safety violation (`SMOKE_CAPITAL_USD > $10` — fail-closed).
- `3` — kill-switch drill failed (panic/recover не сработал).

## RTO / cleanup

- **Reservation cleanup:** smoke резервирует capital с `ttlSeconds=60` + явный release в конце. Если smoke упал mid-phase, TTL (60s) автоматически освободит reservation — ceiling не насыщается дольше минуты.
- **Kill-switch cleanup:** если smoke упал после `panic:stop` но до `panic:recover`, kill-switch остаётся активным. Восстановление: `bash tools/panic-recover.sh --confirm "I UNDERSTAND THIS RESUMES TRADING"` (typed-confirm — не one-click).
- **Reconciliation:** smoke не создаёт mismatches (не выполняет real trades в dry-run); в testnet mode real trades могут создать transient mismatches, которые reconciliation-worker резолвит автоматически.

## Запись результата (DoD Gate 3)

После успешного smoke создайте `docs/live-deploy-smoke-<date>.md` с:
- Дата, mode (dry-run / testnet), `SMOKE_CAPITAL_USD`.
- Результат каждой фазы (passed/failed).
- Для testnet: tx hashes, gas spent, final wallet balances.
- Подпись оператора (typed-confirm).

DoD Gate 3 checklist обновляется ссылками на эти записи.

## Связанные документы

- DoD: [`docs/live-deploy-dod.md`](live-deploy-dod.md) §Gate 3
- Plan: [`.cursor/plans/DEVELOPMENT_PLAN8.md`](../.cursor/plans/DEVELOPMENT_PLAN8.md) §P8-4
- Adapter-level trade test: `npm run e2e:dex-testnet` ([`tools/e2e-dex1-testnet.mjs`](../tools/e2e-dex1-testnet.mjs))
- Multi-chain bridge test: `npm run e2e:dex2-multichain` ([`tools/e2e-dex2-multichain.mjs`](../tools/e2e-dex2-multichain.mjs))
- Panic runbook: [`docs/incident-response-playbook.md`](incident-response-playbook.md)
