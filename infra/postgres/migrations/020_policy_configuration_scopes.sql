-- Config service: staged rollout with scope support (CFG-3).
-- Adds per-scope overrides (environment/tenant/global) and rollback capability.

-- Scope types enum for type safety (idempotent: partial runs may have committed the type)
DO $$
BEGIN
  CREATE TYPE policy_config_scope_type AS ENUM ('global', 'environment', 'tenant');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- Add scope columns to existing policy_configurations table
ALTER TABLE policy_configurations
  ADD COLUMN IF NOT EXISTS scope_type policy_config_scope_type NOT NULL DEFAULT 'global',
  ADD COLUMN IF NOT EXISTS scope_value TEXT NULL, -- NULL for 'global' scope
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true; -- Soft delete for rollback

-- Update unique constraint to include scope (may be a UNIQUE CONSTRAINT, not a standalone index)
ALTER TABLE policy_configurations
  DROP CONSTRAINT IF EXISTS policy_configurations_key_version_unique;
DROP INDEX IF EXISTS policy_configurations_key_version_unique;
CREATE UNIQUE INDEX IF NOT EXISTS policy_configurations_scope_key_version_unique
  ON policy_configurations (config_key, entity_version, scope_type, scope_value);

-- Create index for scoped queries
CREATE INDEX IF NOT EXISTS idx_policy_configurations_scope
  ON policy_configurations (scope_type, scope_value, config_key);

-- Update view to filter by is_active and scope ordering
CREATE OR REPLACE VIEW v_policy_configurations_latest AS
WITH ranked AS (
  SELECT
    id,
    config_key,
    config_value,
    is_sensitive,
    entity_version,
    created_at,
    updated_at,
    updated_by,
    scope_type,
    scope_value,
    is_active,
    ROW_NUMBER() OVER (
      PARTITION BY config_key, scope_type, scope_value
      ORDER BY entity_version DESC
    ) AS rn
  FROM policy_configurations
  WHERE is_active = true
)
SELECT
  id,
  config_key,
  config_value,
  is_sensitive,
  entity_version,
  created_at,
  updated_at,
  updated_by,
  scope_type,
  scope_value
FROM ranked
WHERE rn = 1;

-- Function to get effective configuration value with scope fallback
-- Priority: specific scope -> environment -> global
CREATE OR REPLACE FUNCTION get_effective_config_value(
  p_config_key TEXT,
  p_environment TEXT DEFAULT NULL,
  p_tenant_id TEXT DEFAULT NULL
) RETURNS TABLE (
  id TEXT,
  config_key TEXT,
  config_value TEXT,
  is_sensitive BOOLEAN,
  entity_version INT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  updated_by TEXT,
  scope_type policy_config_scope_type,
  scope_value TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH scoped_configs AS (
    -- Try tenant-specific first
    SELECT 1 AS priority, v.*
    FROM v_policy_configurations_latest v
    WHERE v.config_key = p_config_key
      AND v.scope_type = 'tenant'
      AND v.scope_value = p_tenant_id

    UNION ALL

    -- Then environment-specific
    SELECT 2 AS priority, v.*
    FROM v_policy_configurations_latest v
    WHERE v.config_key = p_config_key
      AND v.scope_type = 'environment'
      AND v.scope_value = p_environment

    UNION ALL

    -- Finally global
    SELECT 3 AS priority, v.*
    FROM v_policy_configurations_latest v
    WHERE v.config_key = p_config_key
      AND v.scope_type = 'global'
  )
  SELECT *
  FROM scoped_configs
  ORDER BY priority ASC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Function to rollback configuration to a specific version
CREATE OR REPLACE FUNCTION rollback_configuration(
  p_config_key TEXT,
  p_to_version INT,
  p_operator_id TEXT,
  p_scope_type policy_config_scope_type DEFAULT 'global',
  p_scope_value TEXT DEFAULT NULL
) RETURNS TEXT AS $$
DECLARE
  v_rollback_id TEXT;
  v_now TIMESTAMPTZ := now();
  v_target_record RECORD;
BEGIN
  -- Find the target version to rollback to
  SELECT * INTO v_target_record
  FROM policy_configurations
  WHERE config_key = p_config_key
    AND entity_version = p_to_version
    AND scope_type = p_scope_type
    AND (scope_value IS NOT DISTINCT FROM p_scope_value)
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target version % not found for key % in scope %/%',
      p_to_version, p_config_key, p_scope_type, p_scope_value;
  END IF;

  -- Mark all newer versions as inactive
  UPDATE policy_configurations
  SET is_active = false,
      updated_at = v_now,
      updated_by = p_operator_id
  WHERE config_key = p_config_key
    AND scope_type = p_scope_type
    AND (scope_value IS NOT DISTINCT FROM p_scope_value)
    AND entity_version > p_to_version
    AND is_active = true;

  -- Create a new version pointing back to the rollback target value
  -- This maintains version history while effectively reverting to the old value
  v_rollback_id := gen_random_uuid()::text;

  INSERT INTO policy_configurations (
    id,
    config_key,
    config_value,
    is_sensitive,
    entity_version,
    created_at,
    updated_at,
    updated_by,
    scope_type,
    scope_value,
    is_active
  )
  VALUES (
    v_rollback_id,
    p_config_key,
    v_target_record.config_value,
    v_target_record.is_sensitive,
    (
      SELECT COALESCE(MAX(entity_version), 0) + 1
      FROM policy_configurations
      WHERE config_key = p_config_key
        AND scope_type = p_scope_type
        AND (scope_value IS NOT DISTINCT FROM p_scope_value)
    ),
    v_now,
    v_now,
    p_operator_id,
    p_scope_type,
    p_scope_value,
    true
  );

  RETURN v_rollback_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get configuration history for rollback UI
CREATE OR REPLACE FUNCTION get_config_history(
  p_config_key TEXT,
  p_scope_type policy_config_scope_type DEFAULT 'global',
  p_scope_value TEXT DEFAULT NULL
) RETURNS TABLE (
  id TEXT,
  config_key TEXT,
  config_value TEXT,
  is_sensitive BOOLEAN,
  entity_version INT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  updated_by TEXT,
  is_active BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    id,
    config_key,
    config_value,
    is_sensitive,
    entity_version,
    created_at,
    updated_at,
    updated_by,
    is_active
  FROM policy_configurations
  WHERE config_key = p_config_key
    AND scope_type = p_scope_type
    AND (scope_value IS NOT DISTINCT FROM p_scope_value)
  ORDER BY entity_version DESC;
END;
$$ LANGUAGE plpgsql;
