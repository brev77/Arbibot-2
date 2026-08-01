-- Migration 050: paper_capital_reservations unique-constraint fix (hotfix)
--
-- PRODUCTION INCIDENT: 4 paper trades stuck in `active` for 18-22h; Phase C
-- (settle) retried every ~5s and failed each time with:
--   duplicate key value violates unique constraint
--   "paper_capital_reservations_instrument_key_state_key"
--
-- ROOT CAUSE: migration 021 declared `UNIQUE (instrument_key, state)
-- DEFERRABLE INITIALLY DEFERRED`. Because `state` is part of the key and only
-- takes values {active, expired}, the table permits AT MOST ONE `expired` row
-- per instrument. `PaperCapitalService.expireReservation()` does an UPDATE
-- (active -> expired) and leaves the row in place (history), so each settled
-- trade leaves an `expired` row behind. When a LATER trade for the same
-- instrument tries to settle, its `active -> expired` UPDATE collides with the
-- pre-existing `expired` row at COMMIT -> unique violation -> settle() throws
-- before the trade is moved to `settled` -> trade stays `active` -> retried
-- forever. Stuck `active` trades then saturate the AutoDrive Phase B
-- concurrency cap (PAPER_AUTO_DRIVE_MAX_CONCURRENT_TRADES counts only `active`),
-- so no new trades are promoted either.
--
-- The 021 inline comment said "Ensure only one active reservation per
-- instrument" — i.e. the INTENT was always a per-instrument cap on ACTIVE rows,
-- not on every (state) value. This migration brings the schema in line with
-- that intent and with the TypeORM entity, which already declares
-- `@Index(['instrumentKey', 'state'], { where: "state = 'active'" })`.
--
-- FIX: drop the composite constraint; add a PARTIAL unique index that enforces
-- uniqueness only over ACTIVE reservations. Expired rows (history/audit) are
-- allowed to accumulate. This is self-healing: immediately after apply, the
-- next AutoDrive Phase C tick re-runs `expireReservation` for each stuck
-- `active` trade; the UPDATE now succeeds (no competing `expired` row blocks
-- it), the trade settles, and the Phase B concurrency headroom is released —
-- no manual data backfill required.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS.
-- Single-writer for the table: paper-trading-service.

-- 1. Drop the over-broad composite unique constraint (active + expired slots).
ALTER TABLE paper_capital_reservations
  DROP CONSTRAINT IF EXISTS paper_capital_reservations_instrument_key_state_key;

-- 2. Enforce the intended invariant: at most one ACTIVE reservation per
--    instrument. The partial predicate means expired rows are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_paper_capital_res_active_per_instrument
  ON paper_capital_reservations (instrument_key)
  WHERE state = 'active';
