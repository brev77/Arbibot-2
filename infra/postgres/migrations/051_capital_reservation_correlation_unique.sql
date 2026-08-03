-- Migration 051: capital_reservations correlation_id idempotency (P9-9)
--
-- PROBLEM: `capital_reservations` (LIVE, created in 001_core.sql) had NO
-- uniqueness constraint on `correlation_id`. `CapitalService.reserve()` accepts
-- `correlationId` from the orchestrator's HTTP request, so a retried
-- `POST /capital/reservations` (timeout, retry middleware) creates a SECOND
-- reservation for the same logical operation — doubling the consumed ceiling or,
-- worse, allowing a plan to execute on twice the capital.
--
-- This mirrors the pattern established in migration 050 for
-- `paper_capital_reservations`: a PARTIAL unique index scoped to ACTIVE rows.
-- Expired/released rows (history/audit) are allowed to accumulate so a
-- correlation_id can be reused across distinct, non-overlapping reservations.
--
-- Idempotent: CREATE UNIQUE INDEX IF NOT EXISTS.
-- Single-writer for the table: capital-service.
--
-- After apply, `CapitalService.reserve()` catches PG unique-violation (code
-- 23505) and returns the existing active reservation instead of throwing —
-- making the HTTP endpoint idempotent on `correlationId` for the ACTIVE window.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_capital_res_active_per_correlation
  ON capital_reservations (correlation_id)
  WHERE state = 'active';
