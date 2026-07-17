# 📚 DOCUMENTS_INDEX — индекс документов Arbibot 2

> Сгенерировано: **2026-07-17**. Единый указатель по всей документации монорепозитория.
> Поддержка: при добавлении нового документа добавляйте его в соответствующий раздел этого индекса.

**Всего:** ~160 markdown-документов (+ ~38 `*.spec.ts` тестовых файлов — не входят в индекс).

---

## 📑 Оглавление

- [🏛 Корневые документы](#-корневые-документы)
- [📐 Архитектурные спецификации верхнего уровня](#-архитектурные-спецификации-верхнего-уровня)
- [🗂 Планы разработки (`.cursor/plans/`)](#-планы-разработки-cursorplans)
- [🤖 Cursor skills & commands (`.cursor/`)](#-cursor-skills--commands-cursor)
- [📖 Документация (`docs/`)](#-документация-docs)
- [🛠 Инфраструктура (`infra/`)](#-инфраструктура-infra)
- [💻 README сервисов и пакетов](#-readme-сервисов-и-пакетов)
- [🧰 Tools](#-tools)
- [🎓 Hermes Agent skills](#-hermes-agent-skills)

---

## 🏛 Корневые документы

| Файл | Назначение |
|------|-----------|
| [README.md](../README.md) | Главная страница проекта |
| [AGENTS.md](../AGENTS.md) | Инструкции для агентов/Cursor (скиллы, скрипты, статусы фаз) |
| [CONTEXT.md](../CONTEXT.md) | Канон доменных терминов (ubiquitous language) |
| [CHANGELOG.md](../CHANGELOG.md) | Журнал изменений (semver) |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Руководство для контрибьюторов |
| [SECURITY.md](../SECURITY.md) | Политика безопасности |
| [LICENSE](../LICENSE) | Лицензия |

## 📐 Архитектурные спецификации верхнего уровня

- [`!Arbibot_2_Architecture_v1_final_docs_settings.md`](../!Arbibot_2_Architecture_v1_final_docs_settings.md)
- [`!Arbibot_2_Frontend_Spec_settings.md`](../!Arbibot_2_Frontend_Spec_settings.md)
- [`!Arbibot_2_Tech_Stack_Proposal_settings.md`](../!Arbibot_2_Tech_Stack_Proposal_settings.md)

---

## 🗂 Планы разработки (`.cursor/plans/`)

### Основные

- [DEVELOPMENT_PLAN.md](../.cursor/plans/DEVELOPMENT_PLAN.md) — главный план (Phases 0–5)
- [DEVELOPMENT_PLAN-DEX.md](../.cursor/plans/DEVELOPMENT_PLAN-DEX.md) — DEX-план (46 шагов)
- [DEVELOPMENT_PLAN3.md](../.cursor/plans/DEVELOPMENT_PLAN3.md) — Hermes Agent + MCP Server
- [DEVELOPMENT_PLAN4.md](../.cursor/plans/DEVELOPMENT_PLAN4.md)
- [DEVELOPMENT_PLAN5.md](../.cursor/plans/DEVELOPMENT_PLAN5.md) — Hermes Agent GLM + Telegram

### Deploy-readiness (`deploy-readiness/`, D4-*)

**Раздел A — Auth & Recovery:**
- [D4-A-0-ADR.md](../.cursor/plans/deploy-readiness/D4-A-0-ADR.md)
- [D4-A-1-AUTH.md](../.cursor/plans/deploy-readiness/D4-A-1-AUTH.md)
- [D4-A-2-PAGING.md](../.cursor/plans/deploy-readiness/D4-A-2-PAGING.md)
- [D4-A-3-RESTORE.md](../.cursor/plans/deploy-readiness/D4-A-3-RESTORE.md)
- [D4-A-4-MIGRATIONS.md](../.cursor/plans/deploy-readiness/D4-A-4-MIGRATIONS.md)
- [D4-A-5-PROBES.md](../.cursor/plans/deploy-readiness/D4-A-5-PROBES.md)
- [D4-A-6-TLS.md](../.cursor/plans/deploy-readiness/D4-A-6-TLS.md)
- [D4-A-7-PAPER-SMOKE.md](../.cursor/plans/deploy-readiness/D4-A-7-PAPER-SMOKE.md)

**Раздел B — Live & Capital Safety:**
- [D4-B-0-LIVE-ADR.md](../.cursor/plans/deploy-readiness/D4-B-0-LIVE-ADR.md)
- [D4-B-1-KILLSWITCH.md](../.cursor/plans/deploy-readiness/D4-B-1-KILLSWITCH.md)
- [D4-B-2-LIMITS.md](../.cursor/plans/deploy-readiness/D4-B-2-LIMITS.md)
- [D4-B-3-CEILING.md](../.cursor/plans/deploy-readiness/D4-B-3-CEILING.md)
- [D4-B-4-KEYS.md](../.cursor/plans/deploy-readiness/D4-B-4-KEYS.md)
- [D4-B-5-BRIDGE.md](../.cursor/plans/deploy-readiness/D4-B-5-BRIDGE.md)
- [D4-B-6-MTLS.md](../.cursor/plans/deploy-readiness/D4-B-6-MTLS.md)
- [D4-B-7-SECRET-SCAN.md](../.cursor/plans/deploy-readiness/D4-B-7-SECRET-SCAN.md)
- [D4-B-8-TWO-PERSON.md](../.cursor/plans/deploy-readiness/D4-B-8-TWO-PERSON.md)
- [D4-B-9-IMPORT-GRAPH.md](../.cursor/plans/deploy-readiness/D4-B-9-IMPORT-GRAPH.md)

**Раздел C — Day-2 Operations:**
- [D4-C-0-DAY2-ADR.md](../.cursor/plans/deploy-readiness/D4-C-0-DAY2-ADR.md)
- [D4-C-1-LOGGING.md](../.cursor/plans/deploy-readiness/D4-C-1-LOGGING.md)
- [D4-C-2-VERSIONING.md](../.cursor/plans/deploy-readiness/D4-C-2-VERSIONING.md)
- [D4-C-3-PANIC.md](../.cursor/plans/deploy-readiness/D4-C-3-PANIC.md)
- [D4-C-4-LIVE-SMOKE.md](../.cursor/plans/deploy-readiness/D4-C-4-LIVE-SMOKE.md)

### DEX (`dex/`)

- [dex-1.0-foundation.md](../.cursor/plans/dex/dex-1.0-foundation.md)
- [dex-1.1-adapters.md](../.cursor/plans/dex/dex-1.1-adapters.md)
- [dex-1.2-observability.md](../.cursor/plans/dex/dex-1.2-observability.md)
- [dex-1.3-operations.md](../.cursor/plans/dex/dex-1.3-operations.md)
- [dex-1.4-networks.md](../.cursor/plans/dex/dex-1.4-networks.md)
- [dex-2-multichain.md](../.cursor/plans/dex/dex-2-multichain.md)
- [dex-doc.md](../.cursor/plans/dex/dex-doc.md)

### Hermes Agent (`hermes/`)

- [H3-A-0-ADR.md](../.cursor/plans/hermes/H3-A-0-ADR.md)
- [H3-A-1-DIRS.md](../.cursor/plans/hermes/H3-A-1-DIRS.md)
- [H3-A-2-FILES.md](../.cursor/plans/hermes/H3-A-2-FILES.md)
- [H3-A-3-BACKEND.md](../.cursor/plans/hermes/H3-A-3-BACKEND.md)
- [H3-A-4-FRONTEND.md](../.cursor/plans/hermes/H3-A-4-FRONTEND.md)
- [H3-A-5-INFRA.md](../.cursor/plans/hermes/H3-A-5-INFRA.md)
- [H3-A-6-DOCS.md](../.cursor/plans/hermes/H3-A-6-DOCS.md)
- [H3-A-7-META.md](../.cursor/plans/hermes/H3-A-7-META.md)
- [H3-A-8-VERIFY.md](../.cursor/plans/hermes/H3-A-8-VERIFY.md)
- [H3-B-0-ADR-MCP.md](../.cursor/plans/hermes/H3-B-0-ADR-MCP.md)
- [H3-B-1-PACKAGE.md](../.cursor/plans/hermes/H3-B-1-PACKAGE.md)
- [H3-B-2-TOOLS.md](../.cursor/plans/hermes/H3-B-2-TOOLS.md)
- [H3-B-3-TESTS.md](../.cursor/plans/hermes/H3-B-3-TESTS.md)
- [H3-C-0-ADR-AGENT.md](../.cursor/plans/hermes/H3-C-0-ADR-AGENT.md)
- [H3-C-1-CONFIG.md](../.cursor/plans/hermes/H3-C-1-CONFIG.md)
- [H3-C-2-SKILLS.md](../.cursor/plans/hermes/H3-C-2-SKILLS.md)
- [H3-C-3-META-UPDATE.md](../.cursor/plans/hermes/H3-C-3-META-UPDATE.md)

### Hermes Agent GLM (`hermes-agent-glm/`)

- [H5-A-0-ADR.md](../.cursor/plans/hermes-agent-glm/H5-A-0-ADR.md)
- [H5-B-1-CONFIG.md](../.cursor/plans/hermes-agent-glm/H5-B-1-CONFIG.md)
- [H5-B-2-ENV.md](../.cursor/plans/hermes-agent-glm/H5-B-2-ENV.md)
- [H5-C-2-SKILLS.md](../.cursor/plans/hermes-agent-glm/H5-C-2-SKILLS.md)
- [H5-D-3-SCRIPTS.md](../.cursor/plans/hermes-agent-glm/H5-D-3-SCRIPTS.md)
- [H5-E-4-DOCKER.md](../.cursor/plans/hermes-agent-glm/H5-E-4-DOCKER.md)
- [H5-F-5-DOCS.md](../.cursor/plans/hermes-agent-glm/H5-F-5-DOCS.md)

---

## 🤖 Cursor skills & commands (`.cursor/`)

### Skills

- [architecture-guard-agent/SKILL.md](../.cursor/skills/architecture-guard-agent/SKILL.md)
- [backend-review-agent/SKILL.md](../.cursor/skills/backend-review-agent/SKILL.md)
- [frontend-review-agent/SKILL.md](../.cursor/skills/frontend-review-agent/SKILL.md)
- [git-workflow-agent/SKILL.md](../.cursor/skills/git-workflow-agent/SKILL.md)
- [dex-security-and-capital-safety/SKILL.md](../.cursor/skills/dex-security-and-capital-safety/SKILL.md)
  - [references/paper-live-boundary.md](../.cursor/skills/dex-security-and-capital-safety/references/paper-live-boundary.md)
  - [references/threat-model.md](../.cursor/skills/dex-security-and-capital-safety/references/threat-model.md)

### Commands

- [architecture-guard-agent.md](../.cursor/commands/architecture-guard-agent.md)
- [backend-review-agent.md](../.cursor/commands/backend-review-agent.md)
- [frontend-review-agent.md](../.cursor/commands/frontend-review-agent.md)
- [review-step.md](../.cursor/commands/review-step.md)

---

## 📖 Документация (`docs/`)

### 📋 Руководства и индексы

- [PROJECT_HANDBOOK.md](PROJECT_HANDBOOK.md) — главный handbook
- **Handbook (разделы):**
  - [handbook/01-system-overview.md](handbook/01-system-overview.md)
  - [handbook/02-architecture-invariants.md](handbook/02-architecture-invariants.md)
  - [handbook/03-local-dev.md](handbook/03-local-dev.md)
  - [handbook/04-testing-and-ci.md](handbook/04-testing-and-ci.md)
  - [handbook/05-operator-runbooks.md](handbook/05-operator-runbooks.md)
  - [handbook/06-observability-security.md](handbook/06-observability-security.md)
  - [handbook/07-secrets-config-and-monitoring.md](handbook/07-secrets-config-and-monitoring.md)
- [TODO.md](TODO.md) — операционный backlog
- [progress.md](progress.md)
- [services.md](services.md)
- [session_summary.md](session_summary.md)

### 🏗 ADR (Architecture Decision Records)

- [adr-dex-structure.md](adr-dex-structure.md)
- [adr-dex2-crosschain.md](adr-dex2-crosschain.md)
- [adr-hermes-agent-integration.md](adr-hermes-agent-integration.md)
- [adr-hermes-agent-glm-telegram.md](adr-hermes-agent-glm-telegram.md)
- [adr-hermes-mcp-server.md](adr-hermes-mcp-server.md)
- [adr-hermes-rename.md](adr-hermes-rename.md)
- [adr-live-gate.md](adr-live-gate.md)
- [adr-observability-logging-release.md](adr-observability-logging-release.md)
- [adr-operator-auth.md](adr-operator-auth.md)
- [adr-phase4-clickhouse-gate.md](adr-phase4-clickhouse-gate.md)
- [adr-phase4-intake-throttling.md](adr-phase4-intake-throttling.md)

### 🚀 Deploy & readiness

- [deployment-checklist.md](deployment-checklist.md) — ⚠️ SUPERSEDED (2026-07-17) by paper-deploy-dod.md
- [deployment-guide.md](deployment-guide.md) — ⚠️ SUPERSEDED (2026-07-17) by paper-deploy-dod.md
- [deployment-readiness-assessment.md](deployment-readiness-assessment.md) — ⚠️ SUPERSEDED (2026-07-17) by D4 deploy-readiness
- [deployment-readiness-review-2026-07.md](deployment-readiness-review-2026-07.md) — ⚠️ SUPERSEDED (2026-07-17) — all findings closed by D4-B/C
- [pre-deploy-review.md](pre-deploy-review.md) — ⚠️ SUPERSEDED (2026-07-17) by paper/live-deploy-dod.md
- [live-deploy-dod.md](live-deploy-dod.md) — live deploy Definition of Done
- [paper-deploy-dod.md](paper-deploy-dod.md) — paper deploy DoD
- [ci-verification-checklist.md](ci-verification-checklist.md)
- [release-process.md](release-process.md)
- [operations/staging-migrations.md](operations/staging-migrations.md)

### 🔐 Security & threat model

- [security-baseline.md](security-baseline.md)
- [security-hardening-guide.md](security-hardening-guide.md)
- [threat-model.md](threat-model.md)
- [vault-integration-guide.md](vault-integration-guide.md)
- [key-rotation-runbook.md](key-rotation-runbook.md)

### 🔭 Observability

- [observability-baseline.md](observability-baseline.md)
- [observability-tracing.md](observability-tracing.md)
- [grafana-dashboard-verification.md](grafana-dashboard-verification.md)
- [capacity-planning.md](capacity-planning.md)

### 🏛 Архитектурные темы (ядровые)

- [aggregates.md](aggregates.md)
- [async-events.md](async-events.md)
- [outbox-inbox.md](outbox-inbox.md)
- [reservation-first.md](reservation-first.md)
- [state-machines.md](state-machines.md)
- [schema-draft.md](schema-draft.md)
- [audit-external-storage.md](audit-external-storage.md)
- [settlement-post-commit.md](settlement-post-commit.md)

### 🎛 Operator UI & flows

- [operator-approval-flow.md](operator-approval-flow.md)
- [operator-ui-complete-guide.md](operator-ui-complete-guide.md)
- [dex-frontend-ui-spec.md](dex-frontend-ui-spec.md)
- [hermes-ui-design.md](hermes-ui-design.md)

### 🤖 Hermes (Phase 5)

- [hermes-gateway-runbook.md](hermes-gateway-runbook.md)
- [hermes-operator-api-spec.md](hermes-operator-api-spec.md)
- [hermes-operator-boundaries.md](hermes-operator-boundaries.md)
- [hermes-reference.md](hermes-reference.md)
- [hermes-safe-mode-runbook.md](hermes-safe-mode-runbook.md)

### 🔄 DEX runbooks

- [dex-arbitrum-runbook.md](dex-arbitrum-runbook.md)
- [dex-base-runbook.md](dex-base-runbook.md)
- [dex-bnb-runbook.md](dex-bnb-runbook.md)
- [dex-live-mainnet-runbook.md](dex-live-mainnet-runbook.md)
- [dex-paper-mainnet-runbook.md](dex-paper-mainnet-runbook.md)
- [dex-testnet-runbook.md](dex-testnet-runbook.md)
- [dex-runbook-bridge.md](dex-runbook-bridge.md)
- [dex-runbook-failed-tx.md](dex-runbook-failed-tx.md)
- [dex-rollback-strategy.md](dex-rollback-strategy.md)
- [dex-load-test-report.md](dex-load-test-report.md)
- [dex-mev-threats.md](dex-mev-threats.md)

### ⚙️ Config keys каталоги

- [policy-config-keys-catalog.md](policy-config-keys-catalog.md)
- [dex-filters-config-keys.md](dex-filters-config-keys.md)
- [opportunity-filters-config-keys.md](opportunity-filters-config-keys.md)
- [intake-policy-config-keys.md](intake-policy-config-keys.md)
- [paper-discovery-config-keys.md](paper-discovery-config-keys.md)
- [cfg-3-staged-rollout.md](cfg-3-staged-rollout.md)

### 🧪 Phase-специфичные документы

- [phase2-risk-policy-roadmap.md](phase2-risk-policy-roadmap.md)
- [phase4-prep-bridge.md](phase4-prep-bridge.md)
- [phase4-ui-degraded-signals.md](phase4-ui-degraded-signals.md)
- [partial-fill-playbooks.md](partial-fill-playbooks.md) — авторитетная реализация (P2-2.2-PLAY)
- [execution-playbooks-draft.md](execution-playbooks-draft.md) — ⚠️ DRAFT/SUPERSEDED (2026-07-17) by partial-fill-playbooks.md
- [paper-promotion-criteria.md](paper-promotion-criteria.md) — авторитетная реализация (PRIO-P2-PROMO)
- [paper-promotion-quality-criteria.md](paper-promotion-quality-criteria.md) — ℹ️ DESIGN INPUT (2026-07-17) for paper-promotion-criteria.md
- [recalibration-spec.md](recalibration-spec.md)
- [route-scoring-logic.md](route-scoring-logic.md)
- [route-scoring-replay.md](route-scoring-replay.md)
- [watchlist-tiering-logic.md](watchlist-tiering-logic.md)

### 📞 Runbooks (операции/инциденты)

- [reconciliation-p0-procedures.md](reconciliation-p0-procedures.md)
- [intake-degradation-runbook.md](intake-degradation-runbook.md)
- [incident-response-playbook.md](incident-response-playbook.md)
- [disaster-recovery-plan.md](disaster-recovery-plan.md)
- [drill-1-paper-incident.md](drill-1-paper-incident.md)

### 🧾 E2E & review gates

- [e2e-scenarios.md](e2e-scenarios.md)
- [local-ci-e2e-phase3-paper-promotion.md](local-ci-e2e-phase3-paper-promotion.md)
- [review-gate-cfg3-paper-discovery.md](review-gate-cfg3-paper-discovery.md)
- [review-handoff-2026-04-20.md](review-handoff-2026-04-20.md)
- [graphify-guide.md](graphify-guide.md)
- [documentation-audit-2026-07.md](documentation-audit-2026-07.md) — 🆕 отчёт аудита документации (2026-07-17)
- [task-d4-b-2d.md](task-d4-b-2d.md)

---

## 🛠 Инфраструктура (`infra/`)

- [grafana/README.md](../infra/grafana/README.md)
- [kubernetes/README.md](../infra/kubernetes/README.md)
- [postgres/README.md](../infra/postgres/README.md)
- [redis/README.md](../infra/redis/README.md)

---

## 💻 README сервисов и пакетов

### Apps

- [apps/hermes-gateway/README.md](../apps/hermes-gateway/README.md)
- [apps/market-intake-service/README.md](../apps/market-intake-service/README.md)

### Frontend (`apps/web/`)

- [apps/web/FRONTEND_GUIDE.md](../apps/web/FRONTEND_GUIDE.md)
- [apps/web/FRONTEND_FIXES_SUMMARY.md](../apps/web/FRONTEND_FIXES_SUMMARY.md)
- [apps/web/QUERY_INVALIDATION.md](../apps/web/QUERY_INVALIDATION.md)
- [apps/web/STACK-CONVENTIONS.md](../apps/web/STACK-CONVENTIONS.md)
- [apps/web/components/README-APPROVAL-FLOW.md](../apps/web/components/README-APPROVAL-FLOW.md)

### Packages

- [packages/contracts-eth/README.md](../packages/contracts-eth/README.md)

---

## 🧰 Tools

- [tools/recalibration/README.md](../tools/recalibration/README.md)
- [tools/hermes-agent/README.md](../tools/hermes-agent/README.md)

---

## 🎓 Hermes Agent skills

> Arbibot-специфичные скиллы для Hermes Agent (NousResearch + GLM 5.2).

- [tools/hermes-agent/skills/daily-report.md](../tools/hermes-agent/skills/daily-report.md) — ежедневный отчёт (cron)
- [tools/hermes-agent/skills/explain-bot.md](../tools/hermes-agent/skills/explain-bot.md) — объяснение работы бота по-русски
- [tools/hermes-agent/skills/force-hedge-preview.md](../tools/hermes-agent/skills/force-hedge-preview.md) — NL impact preview перед force hedge
- [tools/hermes-agent/skills/investigate-incident.md](../tools/hermes-agent/skills/investigate-incident.md) — автоанализ инцидента → рекомендация
- [tools/hermes-agent/skills/reconciliation-check.md](../tools/hermes-agent/skills/reconciliation-check.md) — mismatches → отчёт → рекомендации
- [tools/hermes-agent/skills/risk-summary.md](../tools/hermes-agent/skills/risk-summary.md) — сводка risk decisions за период
- [tools/hermes-agent/skills/safe-mode-check.md](../tools/hermes-agent/skills/safe-mode-check.md) — проверка + рекомендация safe-mode

---

## 🔧 Поддержка индекса

- **При добавлении нового документа:** добавьте строку в соответствующий раздел выше.
- **При удалении/переименовании:** уберите или обновите ссылку.
- **Регенерация списка:** `git ls-files '*.md' '*.mdx'` из корня репо (исключить `node_modules`, `dist`, `.next`, `.git`, `graphify-out`).
- **Условные обозначения:** DoD = Definition of Done; ADR = Architecture Decision Record; MCP = Model Context Protocol.
