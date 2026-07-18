---
name: config_management
description: "Управление настройками бота: чтение, изменение безопасных значений, откат, промоут между scope, активация draft"
readonly: false
tools:
  - list_configs
  - get_config
  - get_effective_config
  - get_config_history
  - update_config
  - rollback_config
  - promote_config
  - activate_config
approval_required:
  - update_config
  - rollback_config
  - promote_config
  - activate_config
---

# Skill: config-management

## Когда использовать
- Оператор просит показать/изменить настройку бота
- «поставь kill switch», «снизь лимит intake», «покажи текущие настройки paper discovery»
- Нужно откатить неудачное изменение конфига
- Промоут настройки из global в environment/tenant scope
- Активировать draft-версию настройки

## Trigger Patterns
- "покажи конфиг", "какие настройки", "текущие настройки"
- "измени настройку", "поставь значение", "поменяй конфиг"
- "откатить настройку", "верни старое значение"
- "change config", "update setting", "show config", "rollback config"
- "/config"

## Последовательность вызовов

1. **Сначала чтение** (без подтверждения):
   - `get_config(configKey)` или `get_effective_config(configKey)` — текущее значение
   - Если оператор не знает ключ — `list_configs()` покажет список
   - При обсуждении истории — `get_config_history(configKey)`

2. **Подтверждение изменения** (mutation):
   - Показать оператору текущее значение и предлагаемое новое
   - Получить явное подтверждение
   - Запросить `approveReason` (обоснование — записывается в audit)

3. **Выполнение mutation** (только после подтверждения):
   - `update_config(configKey, configValue, approveReason)` — новое значение
   - `rollback_config(configKey, toVersion, approveReason)` — откат
   - `promote_config(configKey, fromScopeType, toScopeType, approveReason)` — между scope
   - `activate_config(configKey, approveReason)` — активация draft

## Разрешённые ключи (allowlist)

Hermes может менять **ТОЛЬКО** безопасные (не-sensitive) ключи:
- `intake.*` — throttling, routing tiers
- `paper.*` — paper discovery, paper trading
- `opportunity.*` — фильтры возможностей
- `dex.*` — DEX-настройки, **включая `dex.limits.killSwitch`** (экстренная остановка live-торговли)
- `features.*` — feature flags

Gateway проверяет ключ и отклонит mutation с 403 ещё до записи.

## Запрещённые ключи (sensitive — только через UI `/settings`)

- `risk.*` — risk-оценки, risk-лимиты
- `execution.*` — execution-plan policy
- `capital.*` — reservation policy

Если оператор просит поменять такой ключ — **откажись** и направь в UI.

## Формат ответа

```
⚙️ Настройка «{{configKey}}»

Текущее значение:
{{current_value}}

{{#if proposed}}
Предлагаемое значение:
{{proposed_value}}

ℹ️  Изменение записи: scope={{scope}}, status={{status}}
⚠️  Требует подтверждения: update_config
   Причина: {{approveReason}}
{{/if}}

{{#if after_update}}
✅ Значение обновлено (version {{new_version}}).
   Прежнее значение сохранено в истории — откат: rollback_config toVersion={{prev_version}}.
{{/if}}
```

## Guardrails
- **Только безопасные ключи** (intake/paper/opportunity/dex/features). Никогда не пытайся менять `risk.*`/`execution.*`/`capital.*` — направь оператора в UI `/settings`.
- Все 4 mutation-tools (`update_config`, `rollback_config`, `promote_config`, `activate_config`) — **ТОЛЬКО с подтверждением оператора** в Telegram.
- Всегда показывай оператору текущее значение ПЕРЕД изменением и проси `approveReason`.
- Если ключ не существует или значение невалидно — config-service вернёт ошибку; честно сообщи её оператору.
- operatorId подставляется автоматически из `HERMES_OPERATOR_ID`/`OPERATOR_TELEGRAM_ID` — не запрашивай его у оператора.
- Чтение (`list_configs`, `get_config`, `get_effective_config`, `get_config_history`) — без подтверждения, можно выполнять сразу.
