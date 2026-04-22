# Opportunity filters — policy key (planned)

Reserved **`configKey`:** `opportunity.filters` (JSON string in config-service).

| Field | Type | Description |
|-------|------|-------------|
| `minSpreadBps` | number | Minimum spread in basis points for opportunities to surface |
| `maxConcurrentOpportunities` | number | Cap on concurrent open opportunities (global hint) |
| `blockedVenueIds` | string[] | Venues excluded from discovery / listing |
| `blockedRouteKeys` | string[] | Route keys excluded |

**Consumer:** opportunity-service integration is planned; the operator UI already validates this shape when the key is present (see [`policy-config-keys-catalog.md`](./policy-config-keys-catalog.md)).

**Effective API (when implemented):** `GET /policy/configurations/opportunity.filters/effective` with optional `environment`, `tenantId`.
