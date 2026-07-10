# D4-B-8-TWO-PERSON — Backend two-person approval для деструктивных операций

| Поле | Значение |
|------|----------|
| **depends_on** | `D4-B-0-LIVE-ADR` |
| **risk_level** | `high` |
| **estimated_hours** | 6 |
| **status** | `planned` |

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
