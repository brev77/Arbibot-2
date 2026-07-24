-- Migration 044: scanner-service tables (cross-DEX detector)
--
-- Two tables owned by scanner-service (single-writer). See docs/adr-scanner-service.md §3.
--
--   scanner_instances  — runtime-only status mirror of instance DEFINITIONS (which live in
--                        config-service `scanner.instances`). NO config columns here — only
--                        what the running worker observed (last cycle, error, counters, status).
--   scanner_findings   — raw cross-venue spreads detected by the scanner. A finding is NOT an
--                        opportunity; the scanner publishes filtered findings to opportunity-
--                        service via POST /opportunities and records the resulting opportunity_id.
--
-- Retention: scanner_findings rows older than `scanner.defaults.findingsRetentionDays`
-- (default 7) are deleted by the cleanup worker (Phase 5).

-- ── scanner_instances ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scanner_instances (
  instance_id                    VARCHAR(100) PRIMARY KEY,
  status                         VARCHAR(20)  NOT NULL DEFAULT 'idle',  -- idle | running | error
  cycles_total                   BIGINT       NOT NULL DEFAULT 0,
  findings_total                 BIGINT       NOT NULL DEFAULT 0,
  opportunities_published_total  BIGINT       NOT NULL DEFAULT 0,
  last_cycle_latency_ms          INTEGER      NULL,
  last_run_at                    TIMESTAMPTZ  NULL,
  last_error                     TEXT         NULL,
  updated_at                     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE scanner_instances IS
  'Scanner instance runtime status (single-writer: scanner-service). Instance DEFINITIONS live in config-service scanner.instances; this table mirrors only runtime state, upserted after each cycle.';
COMMENT ON COLUMN scanner_instances.instance_id IS
  'Matches the id field of the instance definition in config-service scanner.instances.';
COMMENT ON COLUMN scanner_instances.status IS
  'idle | running | error — current worker state. error implies last_error is populated.';

-- ── scanner_findings ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scanner_findings (
  id                             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id                    VARCHAR(100) NOT NULL,
  opportunity_id                 UUID         NULL,                       -- set after POST /opportunities
  publish_status                 VARCHAR(20)  NOT NULL DEFAULT 'pending', -- pending | published | failed
  publish_attempts               INTEGER      NOT NULL DEFAULT 0,
  canonical_token                VARCHAR(100) NOT NULL,
  chain_id                       INTEGER      NOT NULL,
  buy_venue                      VARCHAR(50)  NOT NULL,
  sell_venue                     VARCHAR(50)  NOT NULL,
  buy_pool_addr                  VARCHAR(66)  NOT NULL,
  sell_pool_addr                 VARCHAR(66)  NOT NULL,
  spread_bps                     INTEGER      NOT NULL,
  gross_profit_usd               DECIMAL(20,6) NOT NULL,
  net_profit_usd                 DECIMAL(20,6) NOT NULL,                 -- gross − fees − gas (no slippage)
  fees_usd                       DECIMAL(20,6) NOT NULL,
  volume_1h_usd                  DECIMAL(24,8) NULL,                     -- null when volume filter off / unavailable
  volume_24h_usd                 DECIMAL(24,8) NULL,
  observed_at                    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE scanner_findings IS
  'Cross-venue spreads detected by scanner-service (single-writer: scanner-service). A finding is a market observation, NOT an opportunity; filtered findings are published to opportunity-service via POST /opportunities.';
COMMENT ON COLUMN scanner_findings.publish_status IS
  'pending = awaiting first publish attempt or retry; published = opportunity_id set; failed = terminal after max retries (manual re-publish via POST /scanner/findings/:id/re-publish).';
COMMENT ON COLUMN scanner_findings.net_profit_usd IS
  'Gross minus pool fees plus gas estimate. Slippage is NOT modeled here — it lives in execution SlippageProtectionService.';

-- ── Indexes (4 required by scanner-service-plan.md Phase 0 + review-gate) ─────────
-- Retention cleanup (Phase 5 worker): DELETE ... WHERE observed_at < now() - interval 'N days'.
CREATE INDEX IF NOT EXISTS idx_scanner_findings_observed_at
  ON scanner_findings(observed_at);

-- UI "latest findings per instance" queries.
CREATE INDEX IF NOT EXISTS idx_scanner_findings_instance_observed
  ON scanner_findings(instance_id, observed_at DESC);

-- Drilldown opportunity → findings.
CREATE INDEX IF NOT EXISTS idx_scanner_findings_opportunity
  ON scanner_findings(opportunity_id);

-- Orphan retry worker scans only pending rows (partial index keeps it small).
CREATE INDEX IF NOT EXISTS idx_scanner_findings_pending
  ON scanner_findings(publish_status)
  WHERE publish_status = 'pending';
