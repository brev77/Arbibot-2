---
name: investigate_alert
description: "Анализ Prometheus/Alertmanager алертов (диск, ServiceDown, error-rate) и пересказ оператору в Telegram"
readonly: true
tools:
  - list_alertmanager_incidents
---

# Skill: investigate-alert

> **P7-7 — Hermes alert pipeline.** Этот skill читает Prometheus/Alertmanager
> алерты (таблица `alertmanager_incidents`,Forwarded reconciliation-service
> `/alerts/webhook`) — это **другой** домен, чем reconciliation mismatches
> (`list_incidents`). До P7-7 Hermes не видел Prometheus-алерты вообще.

## Когда использовать
- Cron `alert_watch` (каждые 2 мин) — проверить новые firing-алерты
- Оператор спрашивает: "что с алертами?", "есть проблемы?", "disk status?"
- Оператор хочет проверить состояние инфраструктуры

## Trigger Patterns
- "alerts", "alert status", "алерты"
- "disk", "диск", "place на диске"
- "service down", "сервис упал"
- "problems", "проблемы", "что случилось"

## Последовательность вызовов

1. `list_alertmanager_incidents` — получить текущие алерты
   - Без фильтра → все (newest-first по `lastFiredAt`)
   - Для cron `alert_watch`: фильтр `status=firing` (только активные)

2. Дедупликация / state:
   - Сравнить с ранее отправленными (state в memory по fingerprint/alertname)
   - Новые firing → подготовить сводку
   - Уже firing и ранее отправленные → подавить (silent)
   - Перешедшие в resolved → одно "✅ resolved" сообщение

3. Анализ:
   - Группировать по alertname (DiskSpaceCritical, ServiceDown, HighErrorRate…)
   - Для критических (severity=critical) — приоритет и явный призыв к действию
   - Определить impact (диск с Postgres/WAL → риск падения БД и т.п.)

## Формат ответа (Telegram, кратко)

Для новых firing-алертов:

```
🚨 {{count}} активных алерта(ов)

🔴 {{alertname}} — {{severity}}
   {{summary}}
   {{description}}
   Instance: {{instance}}
   Firing since: {{startsAt}}
```

Для resolved (одно на алерт):
```
✅ {{alertname}} resolved
   Был активен {{duration}}
```

Если новых нет (cron `silent: true`):
```
(no output — silent)
```

## Critical-алерты — известные паттерны и рекомендации

| Alertname | Что значит | Рекомендация |
|-----------|-----------|--------------|
| `DiskSpaceCritical` | Диск < 5% (Postgres/WAL под риском) | Срочно: проверить `df -h`, почистить логи/backup'ы, увеличить диск. Риск падения БД. |
| `DiskSpaceLow` | Диск < 15% | Проверить `df -h`, запланировать очистку. |
| `ServiceDown` | Сервис не отвечает на `/metrics` | Проверить `docker compose ps`, логи сервиса, рестарт. |
| `HighErrorRate` | > 5% 5xx ответов | Проверить логи сервиса (Loki), выявить endpoint. |
| `HighMemoryUsage` | Память хоста > 90% | Проверить `docker stats`, найти утечку. |

## Guardrails
- **Read-only**: этот skill НЕ меняет статусы алертов и не выполняет мутации
- Status-переходы (resolve/investigating) — только через operator UI `/incidents`
- Не эскалировать одно и то же firing-состояние чаще, чем `repeat_interval` (4h)
- Для critical-алертов Telegram-сообщение должно быть actionable (что делать),
  не просто констатация
