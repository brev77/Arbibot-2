# DEX Load Test — Report & Thresholds

## Overview

Load test script for DEX infrastructure in `execution-orchestrator`. Tests RPC connectivity, concurrent leg submissions, and DEX metrics availability.

**Script:** `tools/dex-load-test.mjs`
**npm script:** `npm run dex:load-test`

## Usage

```bash
# Dry-run (no real DEX transactions, uses HTTP venue mock)
EXECUTION_API_BASE=http://127.0.0.1:3012 npm run dex:load-test -- --dry-run

# Live (requires DEX adapters configured)
EXECUTION_API_BASE=http://127.0.0.1:3012 npm run dex:load-test
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EXECUTION_API_BASE` | *(required)* | Execution-orchestrator base URL |
| `DEX_LOAD_CONCURRENCY` | `5` | Max concurrent workers (max: 50) |
| `DEX_LOAD_REQUESTS` | `20` | Total requests to send |
| `DEX_LOAD_TIMEOUT_MS` | `10000` | Per-request timeout (ms) |
| `DEX_THRESHOLD_MAX_LATENCY_MS` | `2000` | p95 latency threshold (ms) |
| `DEX_THRESHOLD_MAX_ERROR_RATE` | `0.1` | Max error rate (0..1) |
| `DEX_THRESHOLD_MIN_THROUGHPUT` | `1` | Min requests/sec |

## Test Phases

### Phase 1: Health Check Warmup

Sequential health checks against DEX infrastructure:
- `GET /health/dex` — comprehensive DEX health (RPC, Vault, Wallet, Mempool)
- `GET /health/rpc` — RPC provider latency and status

### Phase 2: Concurrent Submit

Concurrent leg submissions via `POST /v1/submit-leg`:
- Configurable concurrency and total requests
- `--dry-run` mode uses HTTP lab venue (no real DEX transactions)
- Live mode sends DEX-specific metadata (`venueKey`, `chainId`, tokens)
- Measures per-request latency and status codes

### Phase 3: Metrics Scrape

Scrapes `GET /metrics` and checks for DEX-specific Prometheus metrics:
- `arb_dex_rpc_latency_seconds`
- `arb_dex_gas_price_gwei`
- `arb_dex_swap_total`
- `arb_dex_confirmation_seconds`
- `arb_dex_signature_seconds`
- `arb_dex_broadcast_seconds`
- `arb_rpc_latency_seconds`
- `arb_rpc_failures_total`

## Thresholds

The load test passes/fails based on three thresholds:

| Threshold | Default | Description |
|-----------|---------|-------------|
| p95 latency | ≤ 2000ms | 95th percentile response time |
| error rate | ≤ 10% | Combined 0/500/503 responses |
| throughput | ≥ 1 req/s | Requests per second (wall time) |

Thresholds can be tuned via environment variables for different environments (testnet vs mainnet).

## Report Format

The script outputs:
- **Health Check** — latency for `/health/dex` and `/health/rpc`
- **Submit Latency** — min, p50, p95, p99, max, avg, wall time, throughput
- **Status Codes** — distribution of HTTP status codes
- **Errors** — unique error messages (up to 5)
- **Metrics Scrape** — which DEX metrics were found
- **Threshold Checks** — pass/fail for each threshold

Exit codes: `0` = all thresholds passed, `1` = threshold failures, `2` = fatal error.

## Edge Cases

- **RPC rate limiting:** If RPC returns 429, latency will spike and error rate increases
- **Nonce collisions:** Under high concurrency, DEX adapter nonce management is tested
- **Service unavailable:** If execution-orchestrator is down, Phase 1 fails fast
- **Missing metrics:** DEX metrics may be absent if no DEX activity has occurred yet (expected in Phase 1 warmup)

## CI Integration

Optional — run manually for performance validation. Not included in automated CI pipeline.

## Related

- DEX Metrics: `apps/execution-orchestrator/src/execution/dex-metrics.service.ts`
- DEX Health: `apps/execution-orchestrator/src/execution/dex-health.service.ts`
- Grafana Dashboard: `infra/grafana/dashboards/arbibot-dex-overview.json`
- DEX Plan: `.cursor/plans/DEVELOPMENT_PLAN-DEX.md` (DEX-1-2-LOAD-TEST)