---
name: approval_handler
description: "Проверка очереди approvals: pending approvals для оператора. Для команды /approve и cron approval_queue_check"
readonly: true
tools:
  - get_approvals_queue
---

# Skill: approval-queue-check

> **Очередь approvals.** Cron `approval_queue_check` (каждые 5 мин) и команда
> `/approve`. Проверяет, есть ли ожидающие approvals (arm/execute/safe-mode/config),
> которые требуют внимания оператора. Молчит, если очередь пуста (`silent: true`).

## Когда использовать

- Cron `approval_queue_check` (каждые 5 мин) — тихая проверка, уведомление если очередь не пуста
- Команда `/approve` в Telegram — показать всю очередь
- Оператор спрашивает: "approvals?", "что ждёт одобрения?", "pending queue"

## Trigger Patterns

- "approvals", "одобрения", "pending"
- "очередь", "queue"
- "что ждёт?", "что подтвердить?"
- "waiting for approval"

## Последовательность вызовов

1. `get_approvals_queue` — получить pending approvals
   - Без фильтра → все pending
   - Фильтр по `status=pending` (явный)

2. Анализ:
   - Если очередь пуста → молчок (cron `silent: true`) или "✅ No pending approvals" (команда)
   - Если есть pending → сгруппировать по типу (plan/position/safe-mode/config)
   - Подсветить старые pending (pending > approval_timeout_minutes = 5 мин по умолчанию)
   - Подсветить high-value approvals (large notional, destructive actions)

3. Формат уведомления (только если очередь не пуста в cron silent mode)

## Формат ответа (Telegram, кратко)

### Cron `silent: true` (только если очередь не пуста):

```
⏳ {{count}} approval(s) waiting

{{#each approvals}}
{{type_emoji}} {{type}} — {{summary}}
   Requested: {{requestedAt}} ({{age}})
   {{#if urgent}}⚠️ URGENT: {{urgent_reason}}{{/if}}
{{/each}}

Reply with /approve {{id}} to confirm (or reject via UI)
```

Если очередь пуста (silent):
```
(no output — silent)
```

### Команда `/approve` (всегда отвечает):

```
✅ Approval queue ({{count}} pending)

{{#if count > 0}}
{{#each approvals}}
{{type_emoji}} {{id}} — {{type}}
   {{summary}}
   Requested: {{requestedAt}} ({{age}} ago)
   {{#if urgent}}⚠️ URGENT{{/if}}
{{/each}}

To approve: confirm via UI /execution or /settings
{{else}}
Queue is empty — nothing pending.
{{/if}}
```

Legend: 📋 plan | 📊 position | 🛡️ safe-mode | ⚙️ config

## Guardrails

- **Read-only**: этот skill НЕ подтверждает и НЕ отклоняет approvals
- Подтверждение/отклонение — только через operator UI или явный approval flow с typed-phrase
- Для destructive actions (close position, disable safe-mode) — дополнительно typed-phrase в UI
- Не показывать чувствительные детали (полные ключи, private keys) — только summaries
- Approval timeout: 5 мин по умолчанию (`approval_timeout_minutes`); после timeout approval expired
