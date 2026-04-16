# OpenClaw в Arbibot 2 — справка по функциям и границам

Краткая сводка по проекту: **что OpenClaw делает**, **чего не делает**, **как встраивается**. Канон деталей — `!Arbibot_2_Architecture_v1_final_docs_settings.md` (§42–§48), границы API — [openclaw-operator-boundaries.md](openclaw-operator-boundaries.md), дорожная карта — [.cursor/plans/DEVELOPMENT_PLAN.md](../.cursor/plans/DEVELOPMENT_PLAN.md) (Phase 5, шаги `P5-5-*`).

**Состояние реализации:** интеграция OpenClaw запланирована на **Phase 5**; в репозитории есть baseline-документы и заглушка UI [`/openclaw`](../apps/web/app/(operator)/openclaw/page.tsx) (роль `admin`). Отдельного сервиса `openclaw-gateway` / полноценного Operator API для агента пока нет.

---

## Роль в системе

| Аспект | Содержание |
|--------|------------|
| **Назначение** | Внешний **self-hosted** слой агента и автоматизации оператора: каналы (мессенджеры и т.д.), сессии, skills, Control UI — см. [OpenClaw docs](https://docs.openclaw.ai). |
| **Не SoT** | OpenClaw **не** источник истины для портфеля, резервов, планов исполнения и risk decisions; **не** пишет напрямую в доменные таблицы PostgreSQL. |
| **Доступ** | Только через **явный Operator API** / тот же gateway/BFF и RBAC, что и у оператора; мутации — с audit, idempotency, `correlation_id` и **approve-required** где политика требует. |
| **Слои (целевая архитектура)** | OpenClaw Gateway → Skills / workflows → **Arbibot Operator API** → read models и ограниченные action endpoints (§45.1 архитектуры). |

---

## Функции по областям (целевое поведение)

### Control plane (§44.1)

- Читать конфигурацию, feature flags, rollout, режимы.
- Инициировать **ограниченные** команды: safe mode, пауза/возобновление paper, rotate secrets — **только** как approve-required actions, без обхода control plane.

### Observability и audit (§44.2)

- Читать audit trail, алерты, трейсы, таймлайны исполнения, сводки для оператора.
- Формировать **briefs** по инцидентам; **не** переписывать audit log.

### Operator experience (§44.3)

- Conversational-доступ к read-моделям: позиции, сбои execution, статус токенов и маршрутов (в т.ч. из внешних каналов).
- Запуск **pre-filled** runbooks и чеклистов инцидентов (финальное подтверждение — у человека).

### Paper trading (§44.4, §48.2)

- Workflows анализа новых токенов, **paper summaries**, кандидаты на live review, **daily digest** с risk notes, качеством маршрутов и **paper vs live drift**.

### Reconciliation и runbooks (§44.5)

- Сопровождение по шагам reconciliation, failover recovery, подготовка postmortem.
- **Не** принимать окончательное решение по manual review без явного approval оператора.

---

## Операционные сценарии (§48)

1. **Incident summary:** событие из alerting → связанный execution/route context → краткий brief → при необходимости walkthrough runbook.
2. **Paper digest:** daily paper summary → shortlist токенов для review → вложения по риску и drift.
3. **Safe mode:** запрос статуса и impact preview → подтверждение → вызов approve-gated endpoint → запись в audit.

Рекомендуемый поток для чувствительных команд: **запрос → preview эффекта → подтверждение оператора → выполнение** (§47).

---

## Что OpenClaw не должен делать (§45.3)

- Не писать напрямую в доменные сущности: `risk_decisions`, `capital_reservations`, `execution_plans`, `portfolio_positions` (и аналоги).
- Не обходить **control plane approvals** и не получать сервисный токен шире роли `admin` на dashboard без отдельного ADR и согласования (см. [openclaw-operator-boundaries.md](openclaw-operator-boundaries.md)).

---

## Примеры целевых Operator API (черновик §45.2)

Иллюстративный список из архитектуры; реальные пути и схемы фиксируются в OpenAPI при реализации `P5-5-OAPI`:

- `GET` … portfolio / execution / token / route / incidents (read models).
- `POST` … safe-mode, paper pause/resume, runbook start, report generate — с политикой и approval.

---

## UI оператора (`/openclaw`, §5.8 фронт-спеки)

Целевые вкладки: **Status** (gateway, каналы), **Sessions**, **Approvals** (очередь pending/approved/rejected), **Briefs** (ссылки в `/incidents`). Индикатор OpenClaw в top-nav: Connected / Degraded / Down.

---

## Настройки (архитектура §56.6)

Параметры уровня policy (имена из спеки): `openclaw_readonly_mode`, `openclaw_action_approvals_required`, `openclaw_channels_enabled`, `openclaw_incident_briefing_enabled`, `openclaw_daily_digest_enabled`, агрегат `OpenClawConfig`.

---

## Связанные документы

| Документ | Тема |
|----------|------|
| [openclaw-operator-boundaries.md](openclaw-operator-boundaries.md) | SoT, чтение/запись, RBAC, связь с UI |
| [operator-approval-flow.md](operator-approval-flow.md) | OpenClaw не обходит approval |
| `!Arbibot_2_Architecture_v1_final_docs_settings.md` §42–§48 | Полная модель интеграции и сценарии |
| `!Arbibot_2_Frontend_Spec_settings.md` §5.8, §18.7 | Экран `/openclaw`, настройки |
| `!Arbibot_2_Tech_Stack_Proposal_settings.md` | OpenClaw layer, фаза D стека |
| [DEVELOPMENT_PLAN.md](../.cursor/plans/DEVELOPMENT_PLAN.md) | `P0-0.3-OC`, Phase 5 `P5-5-GW`, `OAPI`, `OCUI`, `BRIEF` |
