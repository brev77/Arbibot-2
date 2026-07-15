-- D4-B-3-CEILING: seed config key for the aggregate capital ceiling.
-- Idempotent: skips if an active global row already exists for the key
-- (see v_policy_configurations_latest).
--
-- Key:
--   capital.limits — aggregate capital ceiling + daily notional cap.
--     maxActiveCapitalUsd   — ceiling for SUM(active reservations + open positions)
--     maxDailyNotionalUsd   — daily notional cap (reserved for D4-B-2-style daily tracking)
--
-- Safe defaults (mirror migration 035 spirit): small, conservative caps so a
-- misconfigured prod fails closed rather than open. Operators raise these via
-- config-service after sign-off; env CAPITAL_MAX_ACTIVE_USD is a lower-bound
-- override (env can only tighten, see CapitalLimitsService).

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
  '041-seed-capital-limits',
  'capital.limits',
  '{
    "maxActiveCapitalUsd": 1000,
    "maxDailyNotionalUsd": 10000
  }'::jsonb,
  true,
  1,
  'migration-041',
  'global'::policy_config_scope_type,
  NULL,
  true
WHERE NOT EXISTS (
  SELECT 1
  FROM v_policy_configurations_latest
  WHERE config_key = 'capital.limits'
    AND scope_type = 'global'
    AND scope_value IS NULL
);
