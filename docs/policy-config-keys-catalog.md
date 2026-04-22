# Policy configuration keys — extension catalog

Central list for **config-service** keys (`configKey` + JSON `configValue`). Wired consumers are called out inline; keys without consumers are **reserved** for future services — create them only when you also add a reader and tests.

| `configKey` | Purpose | Consumers (today) | Sensitive prefix |
|-------------|---------|-------------------|-------------------|
| `intake.throttling` | Sampling intervals, route score gate | market-intake-service | no |
| `intake.routing.tiers` | Hot/warm/cold instrument buckets | market-intake-service | no |
| `paper.discovery` | Paper discovery worker thresholds | paper-trading-service | no |
| `opportunity.filters` | Global gating: spread, concurrency, blocklists | _(planned)_ | no |
| `risk.evaluation` | Evaluation strictness, cache TTL hints | _(planned)_ | **yes** (`risk.*`) |
| `risk.limits.bundle` | Documented oversights / bundle metadata (avoid duplicating DB profiles without ADR) | _(planned)_ | **yes** |
| `execution.plan` | Default timeouts, slippage, retries | _(planned)_ | **yes** (`execution.*`) |
| `capital.reservation` | Reservation TTL, in-flight caps | _(planned)_ | **yes** (`capital.*`) |
| `features.flags` | Subsystem toggles for staged rollout | _(planned)_ | no |

## Authoring flow

1. Add or update the JSON via operator **`/settings`** (BFF → config-service).
2. Prefer **draft → activate** for risky keys; use **environment** / **tenant** scope when rolling out (see staging docs in repo).
3. Add **`docs/*-config-keys.md`** when the schema stabilizes; link it from this table.

## Related

- [intake-policy-config-keys.md](./intake-policy-config-keys.md)
- [paper-discovery-config-keys.md](./paper-discovery-config-keys.md)
- [handbook/07-secrets-config-and-monitoring.md](./handbook/07-secrets-config-and-monitoring.md)
