-- Migration 047: seed default JSON policy key `paper.auto_drive` (PAD-4, L3)
--
-- Default value ships with `enabled: false` (safe-by-default): the AutoDriveWorker will not
-- start automated paper trading until an operator explicitly flips the key to `enabled: true`
-- in /settings or via env PAPER_AUTO_DRIVE_ENABLED=true. The kill-switch path
-- (tools/panic-button.sh) also flips PAPER_AUTO_DRIVE_ENABLED=false.
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
  '047-seed-paper-auto-drive',
  'paper.auto_drive',
  '{"enabled":false,"minNetProfitUsd":5,"maxConcurrentTrades":20,"notionalUsd":1000}',
  false,
  1,
  'migration-047',
  'global'::policy_config_scope_type,
  NULL,
  true
WHERE NOT EXISTS (
  SELECT 1
  FROM v_policy_configurations_latest
  WHERE config_key = 'paper.auto_drive'
    AND scope_type = 'global'
    AND scope_value IS NULL
);
