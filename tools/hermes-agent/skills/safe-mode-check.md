---
name: safe-mode-check
description: "Проверка и рекомендация safe-mode: анализ состояния системы и необходимости включения"
readonly: false
tools:
  - get_safe_mode_status
  - enable_safe_mode
  - disable_safe_mode
approval_required:
  - enable_safe_mode
  - disable_safe_mode
---

# Skill: safe-mode-check

## Когда использовать
- "safe mode status", "проверь safe mode", "включи safe mode"
- Monitoring alert: anomalous activity
- Оператор хочет переключить режим

## Trigger Patterns
- "safe mode"
- "safe mode status"
- "enable safe mode"
- "disable safe mode"
- "включи safe mode"
- "выключи safe mode"

## Последовательность вызовов

1. `get_safe_mode_status` — текущий статус safe mode
   - Active/inactive
   - Причина включения (если active)
   - Время последнего изменения

2. Анализ:
   - Если safe mode OFF и есть anomalous conditions → рекомендовать включение
   - Если safe mode ON и conditions нормализовались → рекомендовать выключение
   - Всегда показывать rationale

3. Если требуется переключение:
   - Запросить подтверждение оператора
   - Вызвать `enable_safe_mode` или `disable_safe_mode`

## Формат ответа

```
🛡️ Safe Mode Status

Current State: {{status}}
{{#if active}}
Activated: {{activated_at}}
Reason: {{activation_reason}}
{{/if}}

📊 Analysis:
   {{analysis_text}}

{{#if recommendation_enable}}
⚠️  Recommendation: ENABLE safe mode
   Reason: {{recommendation_reason}}
   Requires approval: enable_safe_mode
{{/if}}

{{#if recommendation_disable}}
✅ Recommendation: DISABLE safe mode
   Reason: {{recommendation_reason}}
   Requires approval: disable_safe_mode
{{/if}}

{{#if no_change}}
ℹ️  No action recommended.
{{/if}}
```

## Guardrails
- Чтение статуса — без подтверждения
- `enable_safe_mode` / `disable_safe_mode` — ТОЛЬКО с подтверждением
- Критический safe mode не выключается автоматически