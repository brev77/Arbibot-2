# H6-A-0-ADR — ADR: Hermes config management

| Поле | Значение |
|------|----------|
| **depends_on** | — |
| **risk_level** | `low` (документация) |
| **status** | done |

## Outputs
- `docs/adr-hermes-config-management.md`.

## Содержание
ADR фиксирует: Hermes получает read + mutation доступ к config-service только для безопасных ключей (allowlist `intake/paper/opportunity/dex/features`); sensitive (`risk/execution/capital`) блокируются gateway 403. Все mutations требуют подтверждения в Telegram. operatorId = `HERMES_OPERATOR_ID ?? OPERATOR_TELEGRAM_ID`. Не нарушает `hermes-operator-boundaries.md` (действия через публичный контракт config-service с audit).

## Test
- Файл существует, содержит Decision / Allowlist / Security / Rollback.
