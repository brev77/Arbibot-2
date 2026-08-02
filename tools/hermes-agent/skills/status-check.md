---
name: status_check
description: "Лёгкая проверка состояния системы (heartbeat): сводка дашборда и открытых инцидентов. Молчит, если всё ок"
readonly: true
tools:
  - get_dashboard_summary
  - list_incidents
---

# Skill: status-check

> **Naming note (P8-1):** frontmatter `name: status_check` (snake_case) — резолвится
> hermes-agent по точному совпадению с `skill: status_check` в `hermes-config.yaml`.
> Имя файла `status-check.md` (kebab-case) — это FS-имя; frontmatter `name:` — канон.

> **Лёгкий heartbeat.** Используется cron'ом `status_heartbeat` (каждые 15 мин) и
> командой `/status`. В отличие от `daily-report`, этот skill **быстрый** и
> **молчит когда всё ок** (`silent: true` в cron) — предназначен для раннего
> обнаружения аномалий, а не для полной сводки.

## Когда использовать

- Cron `status_heartbeat` (каждые 15 мин) — тихий heartbeat, уведомление только при аномалии
- Команда `/status` в Telegram — оператор хочет быстрый обзор
- Оператор спрашивает «как дела?», «всё ок?», «status?», «живой?»

## Trigger Patterns

- "status", "состояние", "как дела", "всё ок"
- "живой", "alive", "heartbeat"
- "что происходит?" (короткий ответ, не детальный)

## Последовательность вызовов

1. `get_dashboard_summary` — получить агрегированную сводку:
   - Открытые инциденты (count)
   - Capital positions (count, total notional USD)
   - Intake degradation status

2. `list_incidents` (опционально, фильтр `status=open`) — получить открытые инциденты

3. Оценка состояния:
   - **OK**: 0 открытых инцидентов, intake не degraded, нет активныхcritical-алертов
   - **WARNING**: 1–2 открытых инцидента ИЛИ intake degraded
   - **CRITICAL**: ≥3 инцидентов ИЛИ есть critical-алерты ИЛИ capital anomaly

## Формат ответа (Telegram, кратко)

### Для cron `silent: true` (только при аномалии):

**Если всё OK — молчок** (cron `silent: true` подавляет):

```
(no output — silent)
```

**Если аномалия:**

```
⚠️ Требует внимания

🔴 Открытых инцидентов: {{open_incidents}}
   {{краткое описание топ-1}}
📊 Capital: {{positions}} позиций, ${{notional}}
{{#if degraded}}⚠️ Intake degraded: {{reasons}}{{/if}}
```

### Для команды `/status` (всегда отвечает):

```
🟢 Arbibot: {{status_emoji}}

📊 Дашборд:
   • Открытых инцидентов: {{open}}
   • Capital positions: {{count}} (${{notional}})
   • Intake: {{ok/degraded}}

{{#if open > 0}}
⚠️ Последний инцидент: {{incidents[0].title}}
{{/if}}
```

Где `status_emoji`: 🟢 OK / 🟡 WARNING / 🔴 CRITICAL.

## Guardrails

- **Read-only**: skill НЕ меняет состояние системы, НЕ подтверждает инциденты
- **Молчаливый по умолчанию в cron** (`silent: true`) — уведомление только при аномалии,
  чтобы не спамить оператора каждые 15 мин
- **Не дублирует `daily-report`**: это heartbeat (быстро, молчаливо), не полный отчёт
- Для детального разбора инцидента → `investigate-incident`
- Для Prometheus-алертов → `investigate-alert`
- Для reconciliation → `reconciliation-check`
