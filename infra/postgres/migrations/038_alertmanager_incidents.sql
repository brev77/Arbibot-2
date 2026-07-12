-- Migration 038: Alertmanager → incidents pipeline
-- Resolves Drill #1 Gap #1: /incidents showed only reconciliation_mismatches.
-- This table stores Prometheus/Alertmanager alerts forwarded via webhook receiver
-- so operators can see them in /incidents alongside reconciliation mismatches.
--
-- NOTE (D4-A-4-MIGRATIONS): This migration was renumbered from 037 to 038 to
-- resolve a version collision with 037_fix_get_effective_config_value.sql
-- (which predates it — added 2026-06-11 vs 2026-06-15). The migration is
-- idempotent (CREATE ... IF NOT EXISTS), so on environments where it was
-- already applied as 037_alertmanager_incidents.sql, re-applying under the
-- new 038 name is a no-op. To keep schema_migrations tidy on such envs, run:
--   UPDATE schema_migrations SET filename = '038_alertmanager_incidents.sql'
--   WHERE filename = '037_alertmanager_incidents.sql';
-- (optional — the duplicate row is harmless because the DDL is idempotent).
--
-- Single-writer: alert-receiver-service (apps/alert-receiver-service, port 3021).
-- Readers: operator-web BFF (GET /incidents merge), incident-response tooling.

CREATE TABLE IF NOT EXISTS alertmanager_incidents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Alertmanager fields
    alert_name      TEXT NOT NULL,
    severity        TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
    status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'investigating', 'resolved', 'firing', 'resolved_external')),
    -- Composite dedup key: same alert firing repeatedly collapses to one incident
    fingerprint     TEXT NOT NULL,
    -- State transition version (optimistic concurrency, like reconciliation_mismatches)
    entity_version  INTEGER NOT NULL DEFAULT 1,
    -- Snapshot of last Alertmanager payload (annotations, labels, value, generatorURL)
    summary         TEXT,
    description     TEXT,
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Lifecycle timestamps
    starts_at       TIMESTAMPTZ,
    ends_at         TIMESTAMPTZ,
    last_fired_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Operator audit fields
    resolved_by     TEXT,
    resolved_at     TIMESTAMPTZ
);

-- Unique index on fingerprint: one row per Alertmanager fingerprint.
-- Alertmanager re-firing the same alert (same fingerprint) is idempotent UPSERT.
CREATE UNIQUE INDEX IF NOT EXISTS uq_alertmanager_incidents_fingerprint
    ON alertmanager_incidents (fingerprint);

-- Lookup indexes for operator UI.
CREATE INDEX IF NOT EXISTS idx_alertmanager_incidents_status
    ON alertmanager_incidents (status, last_fired_at DESC);
CREATE INDEX IF NOT EXISTS idx_alertmanager_incidents_severity
    ON alertmanager_incidents (severity, last_fired_at DESC);
CREATE INDEX IF NOT EXISTS idx_alertmanager_incidents_alert_name
    ON alertmanager_incidents (alert_name);

-- Updated_at trigger for consistency with other entities.
CREATE OR REPLACE FUNCTION trg_alertmanager_incidents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_timestamp_alertmanager_incidents ON alertmanager_incidents;
CREATE TRIGGER set_timestamp_alertmanager_incidents
    BEFORE UPDATE ON alertmanager_incidents
    FOR EACH ROW
    EXECUTE FUNCTION trg_alertmanager_incidents_updated_at();

COMMENT ON TABLE alertmanager_incidents IS
    'Alertmanager webhook → incidents (single-writer: alert-receiver-service). Drill #1 gap #1.';