# Arbibot 2 — План 3: OpenClaw → Hermes

**Прогресс:** 8/17 | **Обновлено:** 2026-06-09 | **Детали шагов:** `.cursor/plans/hermes/`

## Контекст

Переименование OpenClaw gateway → **Hermes** + MCP server + Hermes Agent (NousResearch) интеграция.

**Причины:** (1) путаница с Go-based OpenClaw проектом; (2) подготовка к Hermes Agent (MCP, skills, messaging); (3) единый brand.

**Hermes Agent:** AI-агент с MCP Integration, Skills System, Multi-platform messaging (Telegram/Discord), Cron Scheduling, Subagent Delegation, Memory & Learning.

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

## Статусы фаз

### Фаза A: Переименование (9 шагов)

| step_id | Суть | status | details |
|---------|------|--------|---------|
| `H3-A-0-ADR` | ADR: обоснование + маппинг | done | `hermes/H3-A-0-ADR.md` |
| `H3-A-1-DIRS` | git mv директорий | done | `hermes/H3-A-1-DIRS.md` |
| `H3-A-2-FILES` | git mv файлов (~15) | done | `hermes/H3-A-2-FILES.md` |
| `H3-A-3-BACKEND` | Замена содержимого backend (~21 файл) | done | `hermes/H3-A-3-BACKEND.md` |
| `H3-A-4-FRONTEND` | Замена содержимого frontend (~12 файлов) | done | `hermes/H3-A-4-FRONTEND.md` |
| `H3-A-5-INFRA` | Env/docker/tools/CI (~7 файлов) | done | `hermes/H3-A-5-INFRA.md` |
| `H3-A-6-DOCS` | Docs: 6 rename + 17 update | done | `hermes/H3-A-6-DOCS.md` |
| `H3-A-7-META` | AGENTS.md, README, .cursorrules | done | `hermes/H3-A-7-META.md` |
| `H3-A-8-VERIFY` | npm ci + build + lint + test | planned | `hermes/H3-A-8-VERIFY.md` |

### Фаза B: MCP Server (4 шага)

| step_id | Суть | status | details |
|---------|------|--------|---------|
| `H3-B-0-ADR-MCP` | ADR: MCP architecture | planned | `hermes/H3-B-0-ADR-MCP.md` |
| `H3-B-1-PACKAGE` | Skeleton `packages/hermes-mcp-server/` | planned | `hermes/H3-B-1-PACKAGE.md` |
| `H3-B-2-TOOLS` | MCP tools (14 tools → gateway) | planned | `hermes/H3-B-2-TOOLS.md` |
| `H3-B-3-TESTS` | Тесты + turbo integration | planned | `hermes/H3-B-3-TESTS.md` |

### Фаза C: Agent Integration (4 шага)

| step_id | Суть | status | details |
|---------|------|--------|---------|
| `H3-C-0-ADR-AGENT` | ADR: Agent integration | planned | `hermes/H3-C-0-ADR-AGENT.md` |
| `H3-C-1-CONFIG` | Agent config (provider, MCP) | planned | `hermes/H3-C-1-CONFIG.md` |
| `H3-C-2-SKILLS` | 6 Arbibot skills | planned | `hermes/H3-C-2-SKILLS.md` |
| `H3-C-3-META-UPDATE` | AGENTS.md + .cursorrules update | planned | `hermes/H3-C-3-META-UPDATE.md` |

## Dependency Graph

```
H3-A-0 → H3-A-1 → H3-A-2 → H3-A-3 ─┬─→ H3-A-5 → H3-A-6 → H3-A-7 → H3-A-8
                        └→ H3-A-4 ─┘

H3-A-8 → H3-B-0 → H3-B-1 → H3-B-2 → H3-B-3

H3-B-3 → H3-C-0 → H3-C-1 → H3-C-2 → H3-C-3
```

## Workflow

1. Прочитать индекс (этот файл) — общая картина (~60 строк)
2. Прочитать `hermes/<step_id>.md` — детали текущего шага (~40-60 строк)
3. Реализовать, обновить статус в этом файле
4. Следующий шаг

---
*v1.0 — 2026-06-09*