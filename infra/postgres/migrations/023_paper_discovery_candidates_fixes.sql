-- Fix migration for P3-4 Paper Discovery Pipeline
-- Addresses critical issues from backend review:
-- 1. Remove opportunity_id FK (paper isolation)
-- 2. Remove enqueued status (direct paper trade creation)
-- 3. Add entityVersion for optimistic concurrency
-- 4. Add unique index for deduplication

-- Remove opportunity_id column
ALTER TABLE paper_discovery_candidates DROP COLUMN IF EXISTS opportunity_id;

-- Add entityVersion column with optimistic concurrency
ALTER TABLE paper_discovery_candidates 
ADD COLUMN IF NOT EXISTS entity_version INTEGER DEFAULT 1;

-- Update status enum comment
COMMENT ON COLUMN paper_discovery_candidates.status IS 
  'State machine: discovered -> processed | rejected (enqueued removed per paper isolation)';

-- Add unique index for deduplication across discovery cycles
CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_discovery_dedup 
  ON paper_discovery_candidates(token_key, route_key, created_at);

-- Add comment on entityVersion
COMMENT ON COLUMN paper_discovery_candidates.entity_version IS 
  'Optimistic concurrency version for state transitions (compare-and-set)';

-- Add comment on unique deduplication index
COMMENT ON INDEX idx_paper_discovery_dedup IS 
  'Prevents duplicate candidates for same token/route within same timestamp (discovery cycle idempotency)';
