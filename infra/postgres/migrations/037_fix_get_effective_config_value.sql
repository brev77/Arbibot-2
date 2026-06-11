-- Fix get_effective_config_value: exclude internal 'priority' column from RETURN QUERY.
-- SELECT * FROM scoped_configs CTE returns priority (INT) as column 1,
-- but RETURNS TABLE declares id TEXT as column 1 => PostgreSQL error 42804.
-- Solution: DROP and recreate with explicit column list.

DROP FUNCTION IF EXISTS get_effective_config_value(TEXT, TEXT, TEXT);

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
    -- Tenant-specific (highest priority)
    SELECT 1 AS priority, v.*
    FROM v_policy_configurations_latest v
    WHERE v.config_key = p_config_key
      AND v.scope_type = 'tenant'
      AND v.scope_value = p_tenant_id
    UNION ALL
    -- Environment-specific
    SELECT 2 AS priority, v.*
    FROM v_policy_configurations_latest v
    WHERE v.config_key = p_config_key
      AND v.scope_type = 'environment'
      AND v.scope_value = p_environment
    UNION ALL
    -- Global fallback
    SELECT 3 AS priority, v.*
    FROM v_policy_configurations_latest v
    WHERE v.config_key = p_config_key
      AND v.scope_type = 'global'
  )
  SELECT
    sc.id,
    sc.config_key,
    sc.config_value,
    sc.is_sensitive,
    sc.entity_version,
    sc.created_at,
    sc.updated_at,
    sc.updated_by,
    sc.scope_type,
    sc.scope_value
  FROM scoped_configs sc
  ORDER BY sc.priority ASC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;
