-- Migration 052: execution_legs state CHECK — add 'submitting' (P9-1)
--
-- P9-1 (broadcast idempotency) introduced a new transient leg state
-- `submitting` between `created` and `sent` (two-phase mark-sent: Phase 1
-- commits `created → submitting` before the on-chain broadcast; Phase 3
-- commits `submitting → sent` after). The existing CHECK constraint on
-- `execution_legs.state` (migration 001) did not include `submitting`, so the
-- Phase 1 UPDATE failed at COMMIT with:
--   new row for relation "execution_legs" violates check constraint
--   "execution_legs_state_check"
--
-- This migration drops the old constraint and recreates it with `submitting`
-- added. Idempotent (DROP CONSTRAINT IF EXISTS + no-op if already correct).
--
-- Single-writer for execution_legs: execution-orchestrator.

ALTER TABLE execution_legs
  DROP CONSTRAINT IF EXISTS execution_legs_state_check;

ALTER TABLE execution_legs
  ADD CONSTRAINT execution_legs_state_check CHECK (state IN (
    'created', 'submitting', 'sent', 'acknowledged', 'partiallyFilled',
    'filled', 'rejected', 'canceled', 'timedOut', 'failed'
  ));
