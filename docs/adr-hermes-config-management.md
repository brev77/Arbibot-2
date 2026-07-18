# ADR: Hermes — управление настройками бота (config-service)

**Status:** Accepted
**Date:** 2026-07-18
**Context:** Plan 6 (H6-A-0)
**Supersedes:** нет
**Related:** [`docs/adr-hermes-agent-glm-telegram.md`](adr-hermes-agent-glm-telegram.md) (Plan 5), [`docs/hermes-operator-boundaries.md`](hermes-operator-boundaries.md)

## 1. Контекст

Plan 5 подключил внешнего Hermes Agent (GLM 5.2 + Telegram) к проекту. Сейчас агент умеет только **читать** операционные данные (планы, позиции, инциденты, дашборд, safe-mode) и **выполнять mutations** над исполнением/портфелем/safe-mode с подтверждением оператора.

Владелец продукта просит: **по запросу в Telegram менять настройки бота** — значения в config-service (`intake.throttling`, `paper.discovery`, `dex.limits` и т.д.). Сейчас у агента нет ни одного инструмента для этого, а Hermes Gateway не проксирует в config-service.

## 2. Decision

Hermes получает **полное управление конфигом** (read + update + rollback + promote + activate) через новые MCP tools и новые gateway-роуты `/hermes/v1/config/*`, **но только для безопасных (не-sensitive) ключей**.

### Allowlist (enforcement на стороне gateway)

Gateway проверяет каждый mutation-запрос по двум спискам паттернов:

- **Разрешено** (`config-allowlist.ts`): `^intake\.`, `^paper\.`, `^opportunity\.`, `^dex\.`, `^features\.`.
- **Явно заблокировано** (понятная ошибка оператору): `^risk\.`, `^execution\.`, `^capital\.`.

Чувствительные ключи (`risk.*`, `execution.*`, `capital.*`) — **только через UI `/settings`**. Gateway отклонит mutation с `403` ещё до запроса к config-service.

Чтение (`GET /config/*`) **не проходит** allowlist-проверку — оператор может смотреть любые ключи, в т.ч. sensitive (read-only).

### Двойная защита mutations

1. **Gateway allowlist** — блокирует sensitive-ключи на входе (этот ADR).
2. **config-service `approveReason`** — для sensitive-ключей требует причину (уже существует, но мы идём дальше и запрещаем вообще).
3. **Подтверждение оператора в Telegram** — все 4 config-mutation tools добавлены в `hermes-config.yaml` → `security.approval_required` (механизм уже работает для существующих 6 mutation-tools).

### Поток

```
Operator (Telegram) → Hermes Agent (GLM 5.2)
                          ↓ MCP (stdio)
                    packages/hermes-mcp-server (TS, +8 tools)
                          ↓ HTTP (x-hermes-api-key, operatorId в теле)
                    apps/hermes-gateway /hermes/v1/config/*
                          ├─ allowlist-проверка (403 для sensitive)
                          ├─ HermesAuthGuard + HermesMutationRateLimitGuard
                          └─ signedFetch (HMAC в проде)
                                ↓ HTTP
                          config-service /policy/configurations/*
                                ↓ raw SQL + audit
                          PostgreSQL (policy_configurations)
```

### operatorId

config-service читает `operatorId` из JSON-тела (`@Body('operatorId')`, 400 если нет). MCP-клиент берёт его из env: `HERMES_OPERATOR_ID ?? OPERATOR_TELEGRAM_ID` (т.к. агент уже привязан к одному оператору через Telegram-whitelist, это и есть личность оператора).

## 3. Security boundaries

Соответствует [`docs/hermes-operator-boundaries.md`](hermes-operator-boundaries.md):
- Действия идут через **публичный контракт** config-service (sync REST `/policy/configurations/*`), не через скрытые internal URL.
- Каждая mutation пишется в **audit-service** (`HERMES_CONFIG_UPDATE_OK` / `HERMES_CONFIG_ROLLBACK_*` / `HERMES_CONFIG_PROMOTE_*` / `HERMES_CONFIG_STATUS_*`; `resourceType: 'policy_configuration'`, `actor = operatorId`).
- **Не обходится policy control plane** — у Hermes нет токена шире роли оператора; allowlist сужает его права **ниже** UI (UI может менять sensitive-ключи, Hermes — нет).
- Gateway остаётся чистым прокси (см. [`adr-hermes-mcp-server.md`](adr-hermes-mcp-server.md) §93-96): добавленные роуты — это прокси-обёртки над config-service, LLM-логики в gateway нет.

## 4. Почему allowlist, а не «всё с approveReason»

| Вариант | Плюс | Минус | Вердикт |
|---------|------|-------|---------|
| **Allowlist безопасных ключей** (выбрано) | простая явная граница; LLM не может даже попытаться тронуть capital/risk; понятные ошибки | при добавлении новой безопасной категории надо расширить regex | **Принято** |
| Все ключи + обязательный approveReason | гибкость | полагается на «честность» LLM; риск что агент подберёт approveReason для sensitive; больше площадь атаки | Отклонено |
| Только безопасные + выборочные sensitive (kill-switch) | компромисс | двойной список сложно поддерживать | Отклонено |

## 5. Что НЕ меняется

- `apps/config-service` — **не трогаем** (ни код, ни миграции, ни DTO). RBAC внутри config-service не добавляем (enforcement на стороне gateway).
- Существующие 14 MCP tools / роуты gateway / скиллы — без изменений.
- Auth не ослабляется: `HermesAuthGuard` на входе gateway, `signedFetch` (HMAC в проде) на выходе к config-service.

## 6. Компоненты плана

| Что | Где |
|------|-----|
| ADR (этот файл) | `docs/adr-hermes-config-management.md` |
| Allowlist | `apps/hermes-gateway/src/hermes/config-allowlist.ts` |
| Gateway env + upstream | `hermes-env.ts` (+`getConfigApiBase`), `hermes-upstream.service.ts` (+`putJson`) |
| Gateway DTOs | `apps/hermes-gateway/src/hermes/dto/config-mutation.dto.ts` |
| Gateway controller + service | `hermes-config.controller.ts`, `hermes-config.service.ts`, `http-error.ts` (общий `asExceptionBody`) |
| MCP client | `packages/hermes-mcp-server/src/hermes-client.ts` (+`put`/`patch`, `operatorId`) |
| MCP tools | `packages/hermes-mcp-server/src/tools/config.ts` (8 tools) |
| Агент | `hermes-config.yaml` (+4 в `approval_required`, команда `/config`), `skills/config-management.md` |
| План | `.cursor/plans/DEVELOPMENT_PLAN6.md` |

## 7. Rollback

Убрать `/hermes/v1/config/*` роуты из gateway, `registerConfigTools` из MCP-реестра, 4 tool-имени из `approval_required`, скилл `config-management.md`, этот ADR пометить Superseded. Существующая функциональность агента не пострадает.
