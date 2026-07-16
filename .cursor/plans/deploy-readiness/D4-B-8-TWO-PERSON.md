# D4-B-8-TWO-PERSON — Backend two-person approval для деструктивных операций

> **DESCOPED (2026-07-16):** Шаг отменён product-owner'ом. Решение: two-person approval
> (правило двух разных людей-операторов для подтверждения destructive-операций) не требуется
> для текущего операционного профиля (единственный оператор). Существующие контроли остаются:
> single-operator typed-phrase в `DestructiveOperatorAction` (frontend), audit-записи для всех
> destructive-операций, kill-switch (D4-B-1), capital ceiling (D4-B-3).
>
> **Влияние на другие шаги:**
> - `D4-C-3-PANIC` (panic-recover) — изначально требовал two-person для recovery; адаптирован:
>   recovery требует явного typed-confirm аргумента + audit (см. `D4-C-3-PANIC.md`).
> - `D4-C-4-LIVE-SMOKE` — формально зависит от этого шага; DoD-чеклист составлен без него,
>   go-live гейт переносится на product-owner sign-off.
>
> Если контроль станет нужен (многооператорная команда, compliance-требования) — вернуться
> к этому шагу; архитектурный анализ сохранён ниже.

| Поле | Значение |
|------|----------|
| **depends_on** | `D4-B-0-LIVE-ADR` |
| **risk_level** | `high` |
| **estimated_hours** | 6 |
| **status** | `descoped` |

## Контекст (из ревью)
- `apps/web/components/domain/destructive-operator-action.tsx` — single-operator typed-phrase («CONFIRM»), не two-person rule.
- `requireTwoPersonApproval:true` из миграции 035 **не проверяется в бэкенде**.
- Approval чисто фронтендовый — прямой вызов API обходит (L8).
- `docs/dex-runbook-bridge.md:232` утверждает «Two-person approval required for any force unwind» — не enforced.

## Outputs
1. **Backend approval state machine** — новая таблица (миграция `041_two_person_approvals.sql`):
   - `(id, resource_type, resource_id, action, requested_by, requested_at, approved_by, approved_at, status)`
   - `status: pending → approved | rejected | expired`
2. **`TwoPersonApprovalService`** (в capital-service или новый shared):
   - `request(resourceType, resourceId, action, operatorId)` → создаёт `pending`
   - `approve(id, approverId)` → требует `approverId !== requested_by` (true two-person)
   - `assertApproved(resourceType, resourceId, action)` → throws если не approved
3. **Wire в деструктивные endpoints:**
   - Force unwind / force hedge (bridge, execution)
   - Live-trade broadcast (если `requireOperatorApprovalPerTrade:true`)
   - Config-promote для sensitive keys (`risk.*`, `execution.*`, `capital.*`)
4. **Frontend `DestructiveOperatorAction`** — расширить: первый оператор request'ит, второй approving; показывать «waiting approval from another operator»
5. **Audit** — каждый approve/reject через `AuditClientService`
6. Timeout/expire (например, 1 час) для pending → auto-reject

## Acceptance
- [ ] Деструктивная операция без two-person approval → 403/422 от бэкенда
- [ ] Тот же operator не может approve свой request
- [ ] `requireTwoPersonApproval` config-flag действительно контролирует поведение
- [ ] Прямой API-вызов без approval блокируется (юнит-тест)
- [ ] Audit-запись для request и approve
- [ ] Frontend показывает двухшаговый flow

## Edge Cases
- Operator offline → timeout + re-request; документировать
- Emergency override (single operator при SEV-1) → отдельный `emergencyMode` flag с **строгим audit + post-mortem requirement**, не по умолчанию
- Race: два оператора approve одновременно → только первый валиден, второй видит уже approved

## Test Commands
```bash
npm run test   # affected services
npm run build
npm run db:migrate   # 041
```

## Rollback
`git checkout -- apps/web/components/domain/destructive-operator-action.tsx` + убрать backend wiring + drop table (forward-only)
