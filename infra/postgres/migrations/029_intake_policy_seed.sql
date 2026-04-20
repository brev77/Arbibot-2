-- Phase 4: default JSON policy keys for market-intake (`intake.throttling`, `intake.routing.tiers`).
-- Idempotent: skips if an active global row already exists for the key (see v_policy_configurations_latest).

INSERT INTO policy_configurations (
  id,
  config_key,
  config_value,
  is_sensitive,
  entity_version,
  updated_by,
  scope_type,
  scope_value,
  is_active
)
SELECT
  '029-seed-intake-throttling',
  'intake.throttling',
  '{"requireAuditOnThrottle":true,"warmSampleIntervalMs":2000,"coldSampleIntervalMs":30000,"minRouteScore":0}',
  false,
  1,
  'migration-029',
  'global'::policy_config_scope_type,
  NULL,
  true
WHERE NOT EXISTS (
  SELECT 1
  FROM v_policy_configurations_latest
  WHERE config_key = 'intake.throttling'
    AND scope_type = 'global'
    AND scope_value IS NULL
);

INSERT INTO policy_configurations (
  id,
  config_key,
  config_value,
  is_sensitive,
  entity_version,
  updated_by,
  scope_type,
  scope_value,
  is_active
)
SELECT
  '029-seed-intake-routing-tiers',
  'intake.routing.tiers',
  '{"hot":{"enabled":true,"instrumentKeys":["BTC","ETH"]},"warm":{"enabled":true,"instrumentKeys":["SOL","AVAX"]},"cold":{"enabled":true,"instrumentKeys":["DOGE"]}}',
  false,
  1,
  'migration-029',
  'global'::policy_config_scope_type,
  NULL,
  true
WHERE NOT EXISTS (
  SELECT 1
  FROM v_policy_configurations_latest
  WHERE config_key = 'intake.routing.tiers'
    AND scope_type = 'global'
    AND scope_value IS NULL
);
