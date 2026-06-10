# HERMES gateway — deployment & monitoring

**Related:** [`docs/HERMES-operator-api-spec.md`](HERMES-operator-api-spec.md), [`apps/HERMES-gateway/README.md`](../apps/HERMES-gateway/README.md)

## Deployment

1. Run `HERMES-gateway` as its own process (port **3020** by default).
2. Set `HERMES_API_KEYS` to one or more comma-separated secrets; rotate by overlap (add new key, deploy clients, remove old key).
3. Point upstream env vars at reachable HTTP bases for execution, portfolio, reconciliation, and the operator **`apps/web`** instance (`OPERATOR_WEB_BFF_BASE`) for dashboard summary.
4. For **`apps/web`**, set `HERMES_GATEWAY_URL` and `HERMES_BFF_API_KEY` so the BFF route `/api/operator/HERMES/v1/*` can authenticate to the gateway. Never expose these keys to client bundles.

## Security

- Prefer mTLS or private network between gateway and upstreams in production; API key is a baseline for HERMES callers.
- Reject requests when `HERMES_API_KEYS` is empty (gateway refuses HERMES routes until configured).
- Dashboard summary goes through the same operator BFF URL as operators; avoid granting the gateway broader privileges than operator read paths.

## Monitoring

- Prometheus: `GET /metrics` on the gateway (via `@arbibot/nest-platform` `installMetricsOnFastify`).
- Correlate logs with `x-correlation-id` on requests.

## CI note

`e2e-phase4-tier-routing` and `bus-smoke` jobs should stay green on `main`; local `npm run ci:bus-smoke` may require Docker / WSL per [`docs/TODO.md`](TODO.md).
