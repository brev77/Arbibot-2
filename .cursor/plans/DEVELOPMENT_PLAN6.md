# Arbibot 2 — План 6: Hermes — управление настройками бота

**Прогресс:** 10/10 | **Обновлено:** 2026-07-18 | **Детали шагов:** `.cursor/plans/hermes-config-mgmt/`

## Контекст

По запросу в Telegram Hermes должен уметь **менять настройки бота** (config-service, порт 3019). До Plan 6 у агента не было ни одного инструмента для этого, а Hermes Gateway не проксировал в config-service.

**Принятые решения:**
- **Операции:** полное управление — чтение, update, rollback, promote, activate. Все mutations требуют подтверждения оператора в Telegram (через `security.approval_required` в `hermes-config.yaml`).
- **Охват ключей:** **только безопасные (не-sensitive)** — `intake.*`, `paper.*`, `opportunity.*`, `dex.*`, `features.*`. Чувствительные (`risk.*`/`execution.*`/`capital.*`) — только через UI; gateway блокирует их 403 (allowlist enforcement).

**Двойная защита mutations:** (1) gateway allowlist блокирует sensitive, (2) `security.approval_required` требует подтверждения в Telegram, (3) config-service сам требует `approveReason` для sensitive.

## Целевой профиль

| Параметр | Значение |
|----------|----------|
| Gateway routes | `/hermes/v1/config/*` (новые) |
| Upstream | config-service `:3019` `/policy/configurations/*` |
| MCP tools | +8 (4 read + 4 mutation), всего 22 |
| Allowlist | `intake/paper/opportunity/dex/features` |
| operatorId | `HERMES_OPERATOR_ID` ?? `OPERATOR_TELEGRAM_ID` |
| ADR | `docs/adr-hermes-config-management.md` |

## Статусы фаз

| step_id | Суть | status | details |
|---------|------|--------|---------|
| `H6-A-0-ADR` | ADR: allowlist + границы | done | `hermes-config-mgmt/H6-A-0-ADR.md` |
| `H6-A-1-ALLOWLIST` | `config-allowlist.ts` (`assertConfigKeyAllowed`) | done | `hermes-config-mgmt/H6-A-1-ALLOWLIST.md` |
| `H6-B-1-GATEWAY-UPSTREAM` | `getConfigApiBase` + `putJson` + env | done | `hermes-config-mgmt/H6-B-1-GATEWAY-UPSTREAM.md` |
| `H6-B-2-GATEWAY-DTOS` | `config-mutation.dto.ts` (4 DTO) | done | `hermes-config-mgmt/H6-B-2-GATEWAY-DTOS.md` |
| `H6-B-3-GATEWAY-CONTROLLER` | `hermes-config.controller.ts` + service + module + `http-error.ts` | done | `hermes-config-mgmt/H6-B-3-GATEWAY-CONTROLLER.md` |
| `H6-C-1-MCP-CLIENT` | `HermesClient.put/patch` + `operatorId` | done | `hermes-config-mgmt/H6-C-1-MCP-CLIENT.md` |
| `H6-C-2-MCP-TOOLS` | `tools/config.ts` (8 tools) + tests + index | done | `hermes-config-mgmt/H6-C-2-MCP-TOOLS.md` |
| `H6-D-1-AGENT-CONFIG` | `hermes-config.yaml` approval + `/config` + env/README | done | `hermes-config-mgmt/H6-D-1-AGENT-CONFIG.md` |
| `H6-D-2-AGENT-SKILL` | `skills/config-management.md` | done | `hermes-config-mgmt/H6-D-2-AGENT-SKILL.md` |
| `H6-E-3-DOCS` | Этот план + файлы шагов + AGENTS.md + gateway README | done | `hermes-config-mgmt/H6-E-3-DOCS.md` |

## Dependency Graph

```
H6-A-0 → H6-A-1 → H6-B-1 → H6-B-2 → H6-B-3
                                              └→ H6-C-1 → H6-C-2 → H6-D-1 → H6-D-2 → H6-E-3
```

## Проверка (DoD)

- `npm run build` / `lint` / `test` для `@arbibot/hermes-mcp-server` и `@arbibot/hermes-gateway` — зелёные.
- MCP: 22 tools зарегистрированы (было 14), 27 тестов проходят.
- Gateway: 10 suites / 135 тестов (вкл. 8 новых config-тестов: allowlist блокирует `risk.*`, пропускает `dex.*`).
- `hermes-config.yaml` содержит 4 новых tool в `approval_required`.
- ADR + план + файлы шагов созданы; `AGENTS.md` обновлён.

## Что НЕ делаем

- Не даём Hermes менять sensitive-ключи (gateway 403).
- Не добавляем RBAC внутри config-service (enforcement на gateway).
- Не меняем существующие 14 MCP tools / роуты / скиллы.
- Не ослабляем auth.

---
*v1.0 — 2026-07-18*
