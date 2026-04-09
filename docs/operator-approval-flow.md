# Модель approval для опасных действий (P0-0.1-APPR)

Согласовано с `!Arbibot_2_Frontend_Spec_settings.md` (§5.4, §6): любое **деструктивное** действие оператора проходит preview → явное подтверждение → запись в audit.

## Классификация

| Категория | Примеры | Обязательный двухшаговый flow |
|-----------|---------|------------------------------|
| Исполнение | Force hedge, Force unwind | да + impact preview |
| Токены | Suspend, Block, Promotion to live | да |
| Конфиг | Изменения чувствительных ключей (CFG-2) | да |
| Runbooks | Start destructive step | да |

## Поток

1. **Preview (POST …/preview)**  
   Сервер возвращает: список затронутых `plan_id` / `position_id` / `token_id`, оценка эффекта (read-only), `previewToken` (короткий TTL).

2. **Commit (POST …/confirm)**  
   Тело: `previewToken`, повтор параметров действия, `idempotencyKey`.  
   Сервер проверяет токен, выполняет переход, пишет `audit_log`, эмитирует события через outbox.

3. **Audit**  
   Каждая успешная фиксация — запись с `actor`, `action`, `resource_*`, `payload` (до/после).

## Запреты

- OpenClaw и внешние агенты **не** обходят control plane: только через Operator API с теми же правилами RBAC.
- Нет исполнения без reservation-first там, где это задано доменом (§24.1).
