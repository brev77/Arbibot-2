# ADR: Переименование OpenClaw → Hermes

**Дата:** 2026-06-09
**Статус:** Accepted
**Контекст:** DEVELOPMENT_PLAN3 — Фаза A

## Контекст

Шлюз операторской автоматизации в Arbibot 2 изначально получил кодовое имя **OpenClaw**. За время развития проекта выявились две проблемы:

1. **Путаница с Go-based OpenClaw.** Существует независимый проект OpenClaw на Go, ориентированный на другой домен. Название пересекается в поиске, документации и обсуждениях.
2. **Подготовка к AI-агенту.** Следующий этап развития — интеграция с **Hermes Agent** (NousResearch): MCP server, skills system, multi-platform messaging (Telegram/Discord), cron scheduling, subagent delegation, memory & learning. Единый brand упрощает онбординг и коммуникацию.

## Решение

Переименовать все артефакты OpenClaw → **Hermes** по всему монорепозиторию, затем создать MCP Server (`packages/hermes-mcp-server/`) как мост между Hermes Agent и gateway.

## Маппинг имён

| Формат | Было | Стало |
|---------|------|-------|
| PascalCase | `OpenClaw`/`Openclaw` | `Hermes` |
| camelCase | `openclaw` | `hermes` |
| UPPER | `OPENCLAW` | `HERMES` |
| kebab-case | `openclaw-gateway` | `hermes-gateway` |
| HTTP header | `x-openclaw-api-key` | `x-hermes-api-key` |
| API path | `/openclaw/v1/` | `/hermes/v1/` |
| npm pkg | `@arbibot/openclaw-gateway` | `@arbibot/hermes-gateway` |
| UI route | `/openclaw` | `/hermes` |
| Директория | `apps/openclaw-gateway/` | `apps/hermes-gateway/` |
| Исходники | `src/openclaw/` | `src/hermes/` |

## Целевой профиль

| Параметр | Значение |
|----------|----------|
| Gateway | `apps/hermes-gateway/` (NestJS + Fastify, порт 3020) |
| npm пакет | `@arbibot/hermes-gateway` |
| API prefix | `/hermes/v1/` |
| Auth header | `x-hermes-api-key` |
| Env prefix | `HERMES_*` |
| UI route | `/hermes` |
| MCP Server | `packages/hermes-mcp-server/` (TypeScript) |
| Agent | Hermes Agent (Python, внешний процесс) |

## Риски и митигация

| Риск | Вероятность | Влияние | Митигация |
|------|-------------|---------|-----------|
| Breaking change для deployed env vars | Средняя | Высокое | Поэтапное переименование с верификацией; обновить `.env.example`, docker-compose |
| Git history потеря контекста | Низкая | Низкое | `git mv` сохраняет историю; ADR документирует причину |
| Пропущенные ссылки в source | Средняя | Среднее | Финальная проверка `findstr /s /i "openclaw"` → 0 результатов |
| CI pipeline ломается | Низкая | Высокое | Обновить `ci.yml`, проверить все npm scripts |
| Test snapshots содержат старые имена | Средняя | Низкое | Обновить snapshots при верификации |

## План реализации

**Фаза A — Переименование (9 шагов):**
1. ADR (этот документ)
2. `git mv` директорий
3. `git mv` файлов
4. Замена содержимого backend (~21 файл)
5. Замена содержимого frontend (~12 файлов)
6. Обновление env/docker/tools/CI (~9 файлов)
7. Переименование + обновление документации (6 rename + 17 update)
8. Обновление AGENTS.md, README, .cursorrules
9. Верификация: `npm ci && npm run build && npm run lint && npm run test`

**Фаза B — MCP Server (4 шага):**
1. ADR: MCP architecture
2. Skeleton `packages/hermes-mcp-server/`
3. MCP tools (14 tools → gateway)
4. Тесты + turbo integration

**Фаза C — Agent Integration (4 шага):**
1. ADR: Agent integration
2. Agent config (provider, MCP)
3. 6 Arbibot skills
4. AGENTS.md + .cursorrules update

## Последствия

- Все deployed environments должны обновить env vars (`OPENCLAW_*` → `HERMES_*`)
- Docker image tags изменятся
- API consumers должны переключиться на `/hermes/v1/` и `x-hermes-api-key`
- Git blame будет показывать rename commit; полная история доступна через `git log --follow`

---
*ADR-0015 — 2026-06-09*