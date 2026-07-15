-- Migration 040: portfolio_positions.notional_usd (D4-B-3-CEILING, L3)
--
-- Adds a USD-notional column to portfolio_positions so the aggregate capital
-- ceiling in capital.service.reserve() can SUM open positions alongside active
-- capital_reservations (C1.3: "reservations + открытых позиций ≤ ceiling").
--
-- Single-writer: portfolio-service (PositionsService.confirmFill) accumulates
-- notional_usd on each fill, mirroring the existing quantity accumulation.
-- Reader: capital-service (raw SQL SUM, read-only — single-writer constrains
-- writes, not cross-service reads on the shared Postgres).
--
-- "Open" position = quantity <> 0 (close sets quantity to 0; the row stays).
-- Existing rows backfill to 0 (no historical notional; safe default).
--
-- Forward-only: DEFAULT 0 makes the ALTER non-blocking and rollback-safe.

ALTER TABLE portfolio_positions
    ADD COLUMN IF NOT EXISTS notional_usd NUMERIC(24, 8) NOT NULL DEFAULT 0;

COMMENT ON COLUMN portfolio_positions.notional_usd IS
    'Cumulative USD notional of fills for this position (D4-B-3-CEILING, single-writer: portfolio-service). Counted into the aggregate capital ceiling when quantity <> 0 (open).';
