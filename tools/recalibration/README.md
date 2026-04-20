# Recalibration jobs (PRIO-P2-RECAL)

Offline / scheduled analytics to propose **policy tuning** artifacts (thresholds, tier lists, scoring inputs). Outputs are **draft JSON** for review — apply to live only via **config-service** + operator approval.

## Layout

- `main.py` — stub CLI entrypoint (extend with your calibration algorithm).
- Outputs: stdout JSON or file path via `--out`.

## Usage

**Stub (no history file):**

```bash
python tools/recalibration/main.py --from 2026-04-01 --to 2026-04-20 --tokens BTC,ETH
```

**With route scoring JSONL** (from `npm run export:route-scoring-history`):

```bash
DATABASE_URL=... npm run export:route-scoring-history > /tmp/route-scoring.jsonl
python tools/recalibration/main.py --from 2026-04-01 --to 2026-04-20 --history /tmp/route-scoring.jsonl --out proposed.json
```

## Contract (target)

1. **Input:** date range, optional token/route filters, path to exported history (e.g. `npm run export:route-scoring-history`).
2. **Process:** load aggregates → run model → emit proposed config fragments (`intake.throttling`, `paper.discovery`, profile caps — **namespaced** per ADR).
3. **Output:** JSON suitable for manual `PUT /policy/configurations/:key` or future automated PR.

## Safety

- No direct writes to production DB from this tool.
- No bypass of audit / approval flows (`PRIO-P2-RECAL` in [DEVELOPMENT_PLAN.md](../.cursor/plans/DEVELOPMENT_PLAN.md)).
