# D4-C-4-LIVE-SMOKE — Live (minimal capital) deploy DoD + smoke

| Поле | Значение |
|------|----------|
| **depends_on** | `D4-B-1` … `D4-B-9`, `D4-C-1`, `D4-C-2`, `D4-C-3` |
| **risk_level** | `high` |
| **estimated_hours** | 6 |
| **status** | `planned` |

## Контекст
Финальный гейт перед включением live с минимальным капиталом. Все live-blockers (L1–L8 + C3) должны быть закрыты, day-2 (logging/versioning/panic) — готовы.

## Outputs
- `docs/live-deploy-dod.md` — чеклист Definition of Done для live-deploy:
  - [ ] Все шаги Фазы B (`D4-B-1` … `D4-B-9`) → `done`
  - [ ] D4-C-1 (logging), D4-C-2 (versioning), D4-C-3 (panic) → `done`
  - [ ] Kill-switch реален: `dex.limits.killSwitch=true` блокирует live-leg (D4-B-1)
  - [ ] `dex.limits`/`dex.live` потребляются бэкендом (D4-B-2)
  - [ ] Aggregate capital ceiling enforcement (D4-B-3)
  - [ ] Ключи не в in-memory Map, `Wallet` не кэшируется (D4-B-4)
  - [ ] Bridge confirmation/finality работает на testnet (D4-B-5)
  - [ ] Service-to-service auth enforced (D4-B-6)
  - [ ] `secret-scan` blocking (D4-B-7)
  - [ ] Two-person approval для деструктивных ops (D4-B-8)
  - [ ] Paper/live import-graph CI-gate (D4-B-9)
  - [ ] **Testnet smoke:** минимум 10 paper→live bridge transfers через testnet без loss
  - [ ] **Reconciliation:** 0 mismatches за 24h testnet-прогона
  - [ ] **Capital rehearsal:** reserve → execute → reconcile на минимальной сумме (≤ $10) на testnet
  - [ ] DR-drill: backup+restore выполнен (D4-A-3), panic-button протестирован (D4-C-3)
  - [ ] Operator runbook review: on-call подтвердил готовность по `docs/incident-response-playbook.md`
- Запись smoke-результата в `docs/live-deploy-smoke-<date>.md`

## Acceptance
- [ ] DoD-чеклист полностью пройден
- [ ] Testnet-прогон ≥ 24h без capital-loss / unreconciled mismatches
- [ ] Подпись product-owner на go-live с минимальным капиталом

## Edge Cases
- Mismatch на testnet → blocker, не go-live, triage через reconciliation-p0
- Bridge timeout на testnet → tuning thresholds (D4-B-5) перед mainnet
- Operator turnover → handover session перед go-live

## Test Commands
```bash
# Testnet E2E
npm run e2e:phase3-paper-promotion   # paper baseline
# + custom live testnet script (создать в задаче, если нет)
npm run verify:deployment
npm run db:verify-migrations:all
```

## Rollback
Не требуется (smoke). При провое — `panic:stop` (D4-C-3) + откат образов к `v<prev>` (D4-C-2) + восстановление БД при необходимости (D4-A-3).
