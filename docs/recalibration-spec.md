# Recalibration jobs (PRIO-P2-RECAL)

## Goal

Periodically reconcile **historical execution / paper** outcomes with **token** and **route** profile caps so operators can tighten or relax limits with evidence.

## Current implementation

- **Stub:** [`tools/recalibration/main.py`](../tools/recalibration/main.py) — HTTP snapshot of `GET /policy/token-profiles` and `GET /policy/route-profiles` (requires running `risk-service`).
- **Config:** [`tools/recalibration/config.py`](../tools/recalibration/config.py), README in the same folder.

## Future work

- Warehouse / ClickHouse queries (Phase 4 `P4-4-CH`) for fill latency and slippage distributions.
- Proposed deltas written as **draft** rows in `config-service` for operator approval (CFG-2/3 flows), not direct SQL updates to profile tables.
