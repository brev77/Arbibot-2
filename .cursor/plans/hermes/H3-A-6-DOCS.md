# H3-A-6-DOCS — Переименование + обновление документации

| Поле | Значение |
|------|----------|
| **depends_on** | `H3-A-5-INFRA` |
| **risk_level** | `low` |
| **estimated_hours** | 1.5 |
| **status** | planned |

## Outputs
Переименованные и обновлённые docs файлы

## Переименование (6 файлов)
| Было | Стало |
|------|-------|
| `docs/HERMES-gateway-runbook.md` | `docs/hermes-gateway-runbook.md` |
| `docs/HERMES-operator-api-spec.md` | `docs/hermes-operator-api-spec.md` |
| `docs/HERMES-operator-boundaries.md` | `docs/hermes-operator-boundaries.md` |
| `docs/HERMES-reference.md` | `docs/hermes-reference.md` |
| `docs/HERMES-safe-mode-runbook.md` | `docs/hermes-safe-mode-runbook.md` |
| `docs/HERMES-ui-design.md` | `docs/hermes-ui-design.md` |

## Обновление упоминаний (17 файлов)
`ci-verification-checklist.md`, `deployment-checklist.md`, `deployment-guide.md`, `deployment-readiness-assessment.md`, `dex-runbook-failed-tx.md`, `disaster-recovery-plan.md`, `grafana-dashboard-verification.md`, `handbook/05-operator-runbooks.md`, `handbook/07-secrets-config-and-monitoring.md`, `key-rotation-runbook.md`, `operator-approval-flow.md`, `operator-ui-complete-guide.md`, `progress.md`, `review-handoff-2026-04-20.md`, `security-hardening-guide.md`, `services.md`, `TODO.md`

## Test Commands
```bash
findstr /s /i "HERMES" docs\*.md  # → 0 результатов
```

## Rollback
`git checkout -- docs/`