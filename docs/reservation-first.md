# Reservation-first в контрактах (P0-0.2-RESV)

## Правило

Исполнение (**arm** / **execute**) **запрещено** без валидного **capital reservation token** и пройденной цепочки **EvaluateRisk → RiskDecision** там, где домен это требует.

## Sequence (целевой)

```mermaid
sequenceDiagram
  participant O as OpportunityService
  participant R as RiskService
  participant C as CapitalService
  participant X as ExecutionOrchestrator
  O->>R: EvaluateRisk
  R-->>O: RiskDecision approved
  O->>C: ReserveCapital(planRef)
  C-->>O: reservationId + expiresAt
  O->>X: CreatePlan / attach reservation
  X->>X: transition reserved
  X->>X: ArmPlan(reservation valid, not expired)
```

## OpenAPI

- `POST /execution/plans/{id}/arm` возвращает **409** если резерв отсутствует, истёк или не совпадает `plan_id`.
- `ReserveCapital` принимает опциональный `planId` после создания плана; оркестратор связывает FK.

## События

- `CapitalReserved` до `PlanArmed`.
- Нарушение порядка в логах/метриках — инцидент для reconciliation (Phase 2).
