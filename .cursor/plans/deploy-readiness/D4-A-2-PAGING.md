# D4-A-2-PAGING — Реальный paging в Alertmanager

| Поле | Значение |
|------|----------|
| **depends_on** | — |
| **risk_level** | `medium` |
| **estimated_hours** | 2 |
| **status** | `done` |

## Контекст (из ревью)
`infra/alertmanager/alertmanager.yml`: все receiver'ы → `http://localhost:5001/alerts/*` (несуществующий placeholder). Slack/PagerDuty/Telegram **закомментированы**. В проде как есть — никто не получает страниц; алёрты идут только в `/incidents` UI (P2).

## Outputs
- `infra/alertmanager/alertmanager.yml` — раскомментировать и заполнить реальный receiver (выбрать в ADR или per-окружение):
  - `slack_configs:` с `api_url: '${SLACK_WEBHOOK_URL}'`
  - или `pagerduty_configs:` с `routing_key`
  - или `webhook_configs:` → внешний Telegram-relay
- Убрать/оставить placeholder `localhost:5001` только для dev-стека
- `docs/observability-tracing.md` — обновить секцию on-call (текущая «arbibot-critical schedule» задокументирована, но не подключена)
- Заполнить on-call контакты в `docs/incident-response-playbook.md` (сейчас TBD)

## Acceptance
- [ ] Critical-алёрт (например `ServiceDown`) → доходит до реального канала (Slack/PagerDuty)
- [ ] Receiver больше не указывает на `localhost:5001` в prod-конфиге
- [ ] Секреты (`SLACK_WEBHOOK_URL`/`PAGERDUTY_ROUTING_KEY`) → через env, не в репо

## Edge Cases
- Дабл-пейджинг Alertmanager + `/incidents` UI — оставить оба (UI как audit-trail)
- Тихие часы (silent window) для non-critical — настроить `time_intervals`

## Test Commands
```bash
# Валидация конфига alertmanager
docker run --rm -v $(pwd)/infra/alertmanager/alertmanager.yml:/etc/alertmanager/config.yml prom/alertmanager:latest amtool check-config /etc/alertmanager/config.yml
```

## Rollback
`git checkout -- infra/alertmanager/alertmanager.yml`
