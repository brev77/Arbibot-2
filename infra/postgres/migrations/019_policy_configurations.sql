-- Config service: managed policy configurations with audit trail (CFG-1 / CFG-2).

CREATE TABLE IF NOT EXISTS policy_configurations (
  id TEXT PRIMARY KEY,
  config_key TEXT NOT NULL,
  config_value TEXT NOT NULL,
  is_sensitive BOOLEAN NOT NULL DEFAULT false,
  entity_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NULL, -- operator identifier from audit/identity
  CONSTRAINT policy_configurations_key_version_unique UNIQUE (config_key, entity_version)
);

CREATE INDEX IF NOT EXISTS idx_policy_configurations_config_key
  ON policy_configurations (config_key);

CREATE INDEX IF NOT EXISTS idx_policy_configurations_updated_at
  ON policy_configurations (updated_at DESC);

-- Latest view for config-service queries (read-mostly).
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
    ROW_NUMBER() OVER (PARTITION BY config_key ORDER BY entity_version DESC) AS rn
  FROM policy_configurations
)
SELECT
  id,
  config_key,
  config_value,
  is_sensitive,
  entity_version,
  created_at,
  updated_at,
  updated_by
FROM ranked
WHERE rn = 1;
