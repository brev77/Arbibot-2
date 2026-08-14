-- Migration 057: make bridge-fee columns on dry_run_cross_chain_observations nullable.
--
-- Bug found live (2026-08-14): migration 055 declared bridge_fee_usd / bridge_fee_bps
-- NOT NULL, but the probe writes NULL for them whenever ACROSS_API_KEY is not
-- configured (the intended default — "fee not queried"). Every cross-chain
-- insert failed with a NOT NULL violation, so dry_run_cross_chain_observations
-- stayed empty while price_diff_bps alone is perfectly useful for analysis.
--
-- Semantics after this migration: NULL = bridge fee not queried (Across API
-- disabled); bridge_protocol='none' marks the same condition explicitly.
--
-- Idempotent: DROP NOT NULL is safe to re-run.

ALTER TABLE dry_run_cross_chain_observations
  ALTER COLUMN bridge_fee_usd DROP NOT NULL,
  ALTER COLUMN bridge_fee_bps DROP NOT NULL,
  ALTER COLUMN bridge_finality_seconds DROP NOT NULL,
  ALTER COLUMN bridge_protocol DROP NOT NULL;
