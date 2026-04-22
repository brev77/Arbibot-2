# 05 — Оператор и runbooks

## Paper перед live

Канон: сначала **paper trading** как сквозной операционный тест связки и сбора статистики, затем **live с минимальным капиталом**. Текст и критерии — раздел «Операционная последовательность первичного запуска» в [.cursor/plans/DEVELOPMENT_PLAN.md](../../.cursor/plans/DEVELOPMENT_PLAN.md); кратко также в [README.md](../../README.md).

## UI и BFF

Операторское приложение — `apps/web` (Next.js). Маршруты включают `/dashboard`, `/portfolio`, `/opportunities`, `/execution`, `/tokens`, `/paper`, `/incidents`, `/runbooks`, `/settings`, `/openclaw`. Серверные прокси (BFF) под `app/api/operator/`; перечень эндпоинтов и переменные `*_API_BASE` — [AGENTS.md](../../AGENTS.md) и [apps/web/lib/api-base.ts](../../apps/web/lib/api-base.ts).

Роли в dev: cookie `arbibot_role` или `ARBIBOT_DEV_ROLE` — см. README (*Роли в UI*).

## Мутации и безопасность оператора

Разрушительные и чувствительные действия — превью, подтверждение, аудит: [docs/operator-approval-flow.md](../operator-approval-flow.md). Компонентные заметки — `apps/web/components/README-APPROVAL-FLOW.md`.

## Runbooks по темам

| Тема | Документ |
|------|----------|
| Сверка, P0-процедуры | [reconciliation-p0-procedures.md](../reconciliation-p0-procedures.md) |
| Деградация intake | [intake-degradation-runbook.md](../intake-degradation-runbook.md) |
| OpenClaw gateway | [openclaw-gateway-runbook.md](../openclaw-gateway-runbook.md), [openclaw-safe-mode-runbook.md](../openclaw-safe-mode-runbook.md) |
| Справка по OpenClaw | [openclaw-reference.md](../openclaw-reference.md), [openclaw-operator-boundaries.md](../openclaw-operator-boundaries.md) |
| Конфигурации (CFG-3) | [cfg-3-staged-rollout.md](../cfg-3-staged-rollout.md) |

Настройка политик и секреты в смену: [07 — секреты, настройка, мониторинг](07-secrets-config-and-monitoring.md).

Метрики и SLO: [06 — observability и security](06-observability-security.md).
