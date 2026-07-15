# Arbibot 2 — План 4: Deployment Readiness (Paper → Live)

**Прогресс:** 12/22 | **Обновлено:** 2026-07-15 | **Детали шагов:** `.cursor/plans/deploy-readiness/`
**Источник:** [`docs/deployment-readiness-review-2026-07.md`](../../docs/deployment-readiness-review-2026-07.md)

## Контекст

Закрытие блокеров, выявленных в deployment-readiness review (2026-07). Проект feature-complete, но между документацией и кодом есть разрыв по капитально-критичным контролькам. План ведёт от **paper-deploy** (Фаза A) через **live-gate** (Фаза B) к **day-2** (Фаза C) и go-live с минимальным капиталом.

**Принцип:** paper-first → приёмка → live с минимальным капиталом (зафиксировано в `DEVELOPMENT_PLAN.md`, «Операционная последовательность первичного запуска»).

**Текущий статус проекта (baseline):** Build 21/21 ✅ | Lint 28/28 ✅ | Tests 392/392 ✅ | Migrations 001–037.

## Целевой профиль

| Параметр | Значение |
|----------|----------|
| Стек деплоя | `infra/docker-compose.prod.yml` (canonical target) |
| Paper-gate | Фаза A (7 шагов) — закрытие P1/P2/P3/P7/P8/P9 + smoke |
| Live-gate | Фаза B (10 шагов) — закрытие L1–L8 + C3 |
| Day-2 | Фаза C (5 шагов) — logging/versioning/panic + live smoke |
| Go-live | после `D4-C-4-LIVE-SMOKE` DoD + product-owner sign-off |

## Статусы фаз

### Фаза A: Paper-deploy gate (7 шагов)

> Цель: изолированный paper-deploy проходит end-to-end. Закрывает P1 (auth), P2 (paging), P3 (restore), P7 (миграции), P8 (probes), P9 (TLS).

| step_id | Суть | status | details | из ревью |
|---------|------|--------|---------|----------|
| `D4-A-0-ADR` | ADR: операторский auth | done | `deploy-readiness/D4-A-0-ADR.md` | P1 |
| `D4-A-1-AUTH` | Реализация операторского auth | done | `deploy-readiness/D4-A-1-AUTH.md` | P1 🔴 |
| `D4-A-2-PAGING` | Реальный paging в Alertmanager | done | `deploy-readiness/D4-A-2-PAGING.md` | P2 |
| `D4-A-3-RESTORE` | Починка процедуры restore | done | `deploy-readiness/D4-A-3-RESTORE.md` | P3 |
| `D4-A-4-MIGRATIONS` | Коллизия 037 + prod-процедура | done | `deploy-readiness/D4-A-4-MIGRATIONS.md` | P7 |
| `D4-A-5-PROBES` | /ready vs /live probes | done | `deploy-readiness/D4-A-5-PROBES.md` | P8 |
| `D4-A-6-TLS` | TLS-сертификаты + HSTS | done | `deploy-readiness/D4-A-6-TLS.md` | P9 |
| `D4-A-7-PAPER-SMOKE` | Paper-deploy DoD + smoke | done | `deploy-readiness/D4-A-7-PAPER-SMOKE.md` | гейт |

### Фаза B: Live-gate (10 шагов)

> Цель: капитально-критичные контроли реализованы в коде, а не только в документации. Закрывает L1–L8 + C3. **Ни один шаг нельзя пропустить перед live-капиталом.**

| step_id | Суть | status | details | из ревью |
|---------|------|--------|---------|----------|
| `D4-B-0-LIVE-ADR` | ADR: live-gate архитектура | done | `deploy-readiness/D4-B-0-LIVE-ADR.md` | — |
| `D4-B-1-KILLSWITCH` | Реальный kill-switch в orchestrator | done | `deploy-readiness/D4-B-1-KILLSWITCH.md` | L1 🔴 |
| `D4-B-2-LIMITS` | dex.limits/live + вызов evaluateTrade | done | `deploy-readiness/D4-B-2-LIMITS.md` | L2 🔴 |
| `D4-B-3-CEILING` | Aggregate capital ceiling (C1) | done | `deploy-readiness/D4-B-3-CEILING.md` | L3 🔴 |
| `D4-B-4-KEYS` | Ключи: убрать in-memory Wallet cache | done | `deploy-readiness/D4-B-4-KEYS.md` | L4 🔴 |
| `D4-B-5-BRIDGE` | Bridge confirmation/finality | planned | `deploy-readiness/D4-B-5-BRIDGE.md` | L5 🔴 |
| `D4-B-6-MTLS` | Service-to-service auth enforce | planned | `deploy-readiness/D4-B-6-MTLS.md` | L6 🔴 |
| `D4-B-7-SECRET-SCAN` | secret-scan → blocking CI | planned | `deploy-readiness/D4-B-7-SECRET-SCAN.md` | L7 |
| `D4-B-8-TWO-PERSON` | Backend two-person approval | planned | `deploy-readiness/D4-B-8-TWO-PERSON.md` | L8 🔴 |
| `D4-B-9-IMPORT-GRAPH` | CI paper/live import-graph gate | planned | `deploy-readiness/D4-B-9-IMPORT-GRAPH.md` | C3 |

### Фаза C: Day-2 + Live smoke (5 шагов)

> Цель: операционная зрелость (structured logging, versioning, panic-button) и финальный live-smoke на минимальном капитале. Закрывает P4/P5/P6 + go-live gate.

| step_id | Суть | status | details | из ревью |
|---------|------|--------|---------|----------|
| `D4-C-0-DAY2-ADR` | ADR: logging + versioning | planned | `deploy-readiness/D4-C-0-DAY2-ADR.md` | P4/P5 |
| `D4-C-1-LOGGING` | Structured JSON logging (nestjs-pino) | planned | `deploy-readiness/D4-C-1-LOGGING.md` | P4 |
| `D4-C-2-VERSIONING` | CHANGELOG + semver + git tags | planned | `deploy-readiness/D4-C-2-VERSIONING.md` | P5 |
| `D4-C-3-PANIC` | Единая «красная кнопка» | planned | `deploy-readiness/D4-C-3-PANIC.md` | P6 |
| `D4-C-4-LIVE-SMOKE` | Live (minimal capital) DoD + smoke | planned | `deploy-readiness/D4-C-4-LIVE-SMOKE.md` | go-live |

## Dependency Graph

```
Фаза A (paper-gate):
D4-A-0 ─→ D4-A-1 ─────────────────────────────────────┐
D4-A-2 (parallel) ────────────────────────────────────┤
D4-A-3 (parallel) ────────────────────────────────────┤
D4-A-4 (parallel) ────────────────────────────────────┼─→ D4-A-7-PAPER-SMOKE
D4-A-5 (parallel) ────────────────────────────────────┤     (гейт Фазы B)
D4-A-6 (parallel) ────────────────────────────────────┘

Фаза B (live-gate):
D4-A-7 ─→ D4-B-0-LIVE-ADR ─┬─→ D4-B-1 ─→ D4-B-2
                            ├─→ D4-B-3
                            ├─→ D4-B-4
                            ├─→ D4-B-5
                            ├─→ D4-B-6
                            └─→ D4-B-8
D4-B-7 (parallel, не зависит от B-0)
D4-B-9 (parallel, не зависит от B-0)

Фаза C (day-2 + live smoke):
D4-B-8 ─→ D4-C-0 ─┬─→ D4-C-1 (logging)
                  └─→ D4-C-2 (versioning)
D4-B-1 ─→ D4-C-3 (panic, зависит от kill-switch)
(все шаги Фаз B + C-1/C-2/C-3) ─→ D4-C-4-LIVE-SMOKE (go-live гейт)
```

## Приоритизация внутри фаз

- **Фаза A:** `D4-A-1-AUTH` (P1) — highest priority; остальные A-шаги параллельны.
- **Фаза B:** `D4-B-1` (kill-switch) → `D4-B-2` (limits) — последовательны (limits использует kill-switch-инфра); остальные B-шаги параллельны между собой.
- **Фаза C:** можно вести параллельно с Фазой B после `D4-C-0` (кроме `D4-C-4`, который требует всё).

## Workflow

1. Прочитать индекс (этот файл) — общая картина (~110 строк)
2. Прочитать `deploy-readiness/<step_id>.md` — детали текущего шага (~40-80 строк)
3. Реализовать, прогнать `Test Commands` из детали шага
4. Обновить `status` в этом файле (`planned` → `done`)
5. Следующий шаг по Dependency Graph

## Связанные артефакты

- Источник-ревью: [`docs/deployment-readiness-review-2026-07.md`](../../docs/deployment-readiness-review-2026-07.md)
- Самооценка проекта: `docs/deployment-readiness-assessment.md`
- Операционная последовательность: `DEVELOPMENT_PLAN.md` («Операционная последовательность первичного запуска»)
- Threat model: `.cursor/skills/dex-security-and-capital-safety/references/threat-model.md`
- Paper/live boundary: `.cursor/skills/dex-security-and-capital-safety/references/paper-live-boundary.md`

---
*v1.0 — 2026-07-11*
