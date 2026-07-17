# DEX Testnet Live Runbook

**Step:** DEX-1-3-LIVE-TESTNET  
**Last updated:** 2026-05-10

## Overview

End-to-end testing of DEX execution pipeline on testnet (or paper-dex simulation).  
Runs the full `reserve → arm → DEX legs → settlement` chain without mainnet risk.

## Prerequisites

### Required Services (running)

| Service | Default URL | Port |
|---------|-------------|------|
| market-intake-service | `http://127.0.0.1:3015` | 3015 |
| opportunity-service | `http://127.0.0.1:3010` | 3010 |
| capital-service | `http://127.0.0.1:3011` | 3011 |
| execution-orchestrator | `http://127.0.0.1:3012` | 3012 |

### Database

PostgreSQL must be migrated (migrations 001–043 applied):

```bash
npm run db:migrate
```

### Paper Mode (default)

No additional prerequisites. Uses `paper-dex` venue adapter (simulated swaps).

### Testnet Mode

Additional requirements for real on-chain testnet transactions:

1. **RPC endpoint** — Set `RPC_URL_ARBITRUM_SEPOLIA` (or relevant chain)
2. **Funded wallet** — Testnet ETH on Arbitrum Sepolia (faucet)
3. **Feature flag** — `DEX_VENUE_ENABLED=true` on execution-orchestrator
4. **Token approvals** — Test tokens may need approval on testnet DEX

## Running the Test

### Paper Mode (default, no risk)

```bash
# Start services
npm run dev:intake & npm run dev:opportunity & npm run dev:capital & npm run dev:execution &

# Run test (default: paper mode)
node tools/e2e-dex1-testnet.mjs

# Explicit paper mode
node tools/e2e-dex1-testnet.mjs --paper
node tools/e2e-dex1-testnet.mjs --dry-run
```

### Testnet Mode (real on-chain)

```bash
# Set environment variables
export DEX_VENUE_ENABLED=true
export RPC_URL_ARBITRUM_SEPOLIA=https://sepolia-rollup.arbitrum.io/rpc
export DEX_E2E_CHAIN_ID=421613
export DEX_E2E_TOKEN_IN=0x980B62Da83eEff3D24539965B7DCf7B2F093deD4  # WETH Sepolia
export DEX_E2E_TOKEN_OUT=0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d  # USDC Sepolia

# Run with --testnet flag
node tools/e2e-dex1-testnet.mjs --testnet
```

### Custom Parameters

```bash
# Override defaults
DEX_E2E_NOTIONAL_USD=50 \
DEX_E2E_VENUE_KEY=uniswap-v3 \
DEX_E2E_CHAIN_ID=84532 \
DEX_E2E_AMOUNT_IN=50000000000000000 \
DEX_E2E_TIMEOUT_MS=60000 \
node tools/e2e-dex1-testnet.mjs --testnet
```

## Test Phases

### Phase 1: Health Check
- Verifies execution-orchestrator `/health`
- Checks DEX infrastructure health (`/health/dex`)
- On testnet: aborts if DEX unhealthy
- On paper: continues with warning

### Phase 2: Execution Chain
Full reservation-first chain:
1. Ingest snapshot via market-intake
2. Create + enrich opportunity
3. Request risk evaluation
4. Create execution plan with `playbookConfig.dexSwaps`
5. Reserve capital
6. Link reservation → arm plan
7. Begin execution (creates legs)
8. For each leg: `mark-sent` → `mark-acknowledged` → `apply-fill`
9. Verify plan state = `completed`

### Phase 3: Metrics Verification
- Scrapes `/metrics` endpoint
- Paper mode: checks `arb_paper_dex_*` metrics
- Testnet mode: checks `arb_dex_*` metrics

## Success Criteria

| Criterion | Expected |
|-----------|----------|
| Plan state | `completed` |
| All legs | `filled` |
| Errors | 0 |
| Total duration | < 60s |

Exit codes:
- `0` — All checks passed
- `1` — Threshold/check failure
- `2` — Fatal error (service down, etc.)

## Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `EXECUTION_API_BASE` | `http://127.0.0.1:3012` | Execution orchestrator URL |
| `MARKET_INTAKE_API_BASE` | `http://127.0.0.1:3015` | Market intake URL |
| `OPPORTUNITY_API_BASE` | `http://127.0.0.1:3010` | Opportunity service URL |
| `CAPITAL_API_BASE` | `http://127.0.0.1:3011` | Capital service URL |
| `DEX_E2E_NOTIONAL_USD` | `10` | Notional USD (testnet-safe) |
| `DEX_E2E_VENUE_KEY` | `paper-dex` / `uniswap-v2` | Venue adapter key |
| `DEX_E2E_CHAIN_ID` | `421613` | Chain ID (Arbitrum Sepolia) |
| `DEX_E2E_TOKEN_IN` | WETH Sepolia address | Input token |
| `DEX_E2E_TOKEN_OUT` | USDC Sepolia address | Output token |
| `DEX_E2E_AMOUNT_IN` | `100000000000000000` | Amount in wei (0.1 ETH) |
| `DEX_E2E_TIMEOUT_MS` | `30000` | Per-request timeout |
| `DEX_E2E_MAX_CONFIRM_WAIT_MS` | `120000` | Max testnet confirmation wait |

## Troubleshooting

### "Execution orchestrator not healthy"
- Verify service is running: `curl http://127.0.0.1:3012/health`
- Check database connection and migrations

### "DEX infrastructure unhealthy" (testnet mode)
- Check RPC connectivity: `curl -X POST $RPC_URL -d '{"jsonrpc":"2.0","method":"eth_blockNumber"}'`
- Verify wallet has testnet ETH
- Check `DEX_VENUE_ENABLED=true`

### Testnet congestion
- Increase `DEX_E2E_TIMEOUT_MS` and `DEX_E2E_MAX_CONFIRM_WAIT_MS`
- Try different RPC endpoint

### Insufficient testnet tokens
- Use faucet to get testnet ETH
- Reduce `DEX_E2E_AMOUNT_IN`

### Revert from testnet DEX
- Check token approval: wallet must approve DEX router
- Verify token addresses are correct for the testnet network
- Check liquidity exists in the testnet pool

## Comparison: Paper vs Testnet

| Aspect | Paper | Testnet |
|--------|-------|---------|
| Real transactions | No | Yes |
| Requires wallet | No | Yes |
| Requires RPC | No | Yes |
| Gas costs | Simulated | Real (testnet ETH) |
| Execution time | < 5s | 5–30s |
| Risk | None | None (testnet) |

## Next Steps

After successful testnet E2E:
1. Review comparison metrics (paper vs testnet latency)
2. Proceed to `DEX-1-3-PAPER-MAINNET` — paper on mainnet data
3. Then `DEX-1-3-LIVE-MAINNET` — mainnet with minimal capital
</task_progress>
</write_to_file>