# State machines агрегатов (P0-0.2-SM)

## ArbitrageOpportunity

```mermaid
stateDiagram-v2
  [*] --> detected
  detected --> enriched
  enriched --> risk_checked
  risk_checked --> expired
  risk_checked --> superseded
```

Переходы только через **opportunity-service** с compare-and-set по `entity_version`.

## RiskDecision

Жизненный цикл: создание записи (**immutable** с точки зрения бизнес-исхода). Корректировки политик не переписывают прошлые решения — новая оценка = новая запись.

Состояния исхода: `approved` | `rejected` | `deferred` (поле outcome).

## ExecutionPlan

```mermaid
stateDiagram-v2
  [*] --> planned
  planned --> reserved
  reserved --> armed
  armed --> executing
  executing --> completed
  executing --> hedged
  executing --> unwound
  executing --> failed
  planned --> canceled
  reserved --> canceled
  armed --> canceled
```

## ExecutionLeg

```mermaid
stateDiagram-v2
  [*] --> created
  created --> sent
  sent --> acknowledged
  acknowledged --> partiallyFilled
  acknowledged --> filled
  sent --> rejected
  sent --> canceled
  sent --> timedOut
  sent --> failed
```

## CapitalReservation

`active` → `released` | `expired` (TTL worker или явный release).

## PortfolioPosition (Phase 2+)

Отдельная спека при появлении сервиса портфеля; связь с `PlanCompleted` / `PositionClosed`.
