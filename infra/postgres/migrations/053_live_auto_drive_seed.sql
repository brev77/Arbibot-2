-- Migration 053: seed default JSON policy key `live.auto_drive` (PLAN10 P10-1, L3)
--
-- Default value ships with `enabled: false` (safe-by-default): the LiveAutoDriveWorker
-- will not start automated live trading until an operator explicitly flips the key to
-- `enabled: true` in /settings or via env LIVE_AUTO_DRIVE_ENABLED=true. The kill-switch
-- path (tools/panic-button.sh) also flips LIVE_AUTO_DRIVE_ENABLED=false, and
-- panic-recover.sh intentionally does NOT restore it (recovery must never auto-restart
-- automated live trading — mirror of paper.auto_drive semantics from migration 047).
--
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
  '053-seed-live-auto-drive',
  'live.auto_drive',
  '{"enabled":false,"minNetProfitUsd":5,"maxConcurrentPlans":3,"notionalUsd":50}',
  false,
  1,
  'migration-053',
  'global'::policy_config_scope_type,
  NULL,
  true
WHERE NOT EXISTS (
  SELECT 1
  FROM v_policy_configurations_latest
  WHERE config_key = 'live.auto_drive'
    AND scope_type = 'global'
    AND scope_value IS NULL
);
