# D4-A-7-PAPER-SMOKE — Paper-deploy smoke + DoD-чеклист

| Поле | Значение |
|------|----------|
| **depends_on** | `D4-A-1-AUTH`, `D4-A-2-PAGING`, `D4-A-3-RESTORE`, `D4-A-4-MIGRATIONS`, `D4-A-5-PROBES`, `D4-A-6-TLS` |
| **risk_level** | `high` |
| **estimated_hours** | 4 |
| **status** | `done` |

## Контекст
Финальный гейт Фазы A — проверить, что изолированный paper-deploy проходит end-to-end после закрытия P1/P2/P3/P7/P8/P9.

## Outputs
- `docs/paper-deploy-dod.md` — чеклист Definition of Done для paper-deploy:
  - [ ] Стек `docker compose -f infra/docker-compose.prod.yml up -d` поднимается зелёным
  - [ ] `npm run verify:deployment` — все сервисы отвечают `/health/ready` 200
  - [ ] `npm run db:verify-migrations:all` — все миграции применены
  - [ ] `npm run verify:env` — нет `ARBIBOT_DEV_ROLE`, секреты на месте
  - [ ] Operator auth: подделанная `arbibot_role=admin` **не** даёт доступ (D4-A-1)
  - [ ] Paging: тестовый алёрт доходит до Slack/PagerDuty (D4-A-2)
  - [ ] Backup+restore: `npm run db:backup && npm run db:restore` работает на прод-хосте (D4-A-3)
  - [ ] TLS: `https://<host>/` без warnings (D4-A-6)
  - [ ] Paper trading E2E: `npm run e2e:phase3-paper-promotion` проходит против прод-хоста
  - [ ] Grafana: все 7 дашбордов показывают данные
- Запись результата smoke в `docs/session_summary.md` (или новый `docs/paper-deploy-smoke-<date>.md`)

## Acceptance
- [ ] DoD-чеклист полностью пройден на целевом paper-хосте
- [ ] Любые найденные проблемы либо устранены, либо завёны как backlog-задачи

## Edge Cases
- Часть сервисов не отвечает → triage через `/health/ready` checks (видно, какая зависимость упала)
- Mismatch между локальной dev-БД и prod — сверить через `db:verify-migrations:all`

## Test Commands
```bash
npm run verify:env
npm run verify:deployment
npm run db:verify-migrations:all
npm run e2e:phase3-paper-promotion   # против прод-хоста (переопределить URLs)
```

## Rollback
Не требуется (smoke-проверка, код не меняет). При провое — откатить образы к предыдущему SHA: `IMAGE_TAG=<prev-sha> docker compose -f infra/docker-compose.prod.yml up -d`
