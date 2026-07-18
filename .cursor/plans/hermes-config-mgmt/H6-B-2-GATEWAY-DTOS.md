# H6-B-2-GATEWAY-DTOS — config-mutation.dto.ts

| Поле | Значение |
|------|----------|
| **depends_on** | `H6-B-1-GATEWAY-UPSTREAM` |
| **risk_level** | `low` |
| **status** | done |

## Outputs
- `apps/hermes-gateway/src/hermes/dto/config-mutation.dto.ts`.

## DTO
- `ConfigUpdateDto`: configValue (обязат.), scopeType/scopeValue/status (опц.).
- `ConfigRollbackDto`: toVersion (Int), scopeType/scopeValue (опц.).
- `ConfigPromoteDto`: fromScopeType/toScopeType (обязат.), fromScopeValue/toScopeValue (опц.).
- `ConfigStatusDto`: status (ConfigurationStatus), scopeType/scopeValue (опц.).
- Все наследуют `HermesOperatorMutationDto` (operatorId + approveReason + idempotencyKey).
- Enums: `ConfigScopeType` (global/environment/tenant), `ConfigurationStatus` (draft/active).

## Test
- Build OK (enum-типы компилируются).
