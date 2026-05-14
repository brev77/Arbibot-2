-- DEX-1-3-LIVE-MAINNET: seed config keys for DEX live limits (capital, risk, gas ceilings).
-- Idempotent: skips if an active global row already exists for the key (see v_policy_configurations_latest).
--
-- Keys:
--   dex.limits          — per-chain capital / position / daily limits, gas ceilings, enabled flag
--   dex.live            — live mode toggle, chains, two-person rule, kill switch

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
  '035-seed-dex-limits',
  'dex.limits',
  '{
    "enabled": false,
    "maxNotionalPerTradeUsd": 500,
    "maxDailyNotionalUsd": 5000,
    "maxOpenPositions": 3,
    "maxSlippageBps": 50,
    "chains": {
      "42161": {
        "enabled": false,
        "maxGasPriceGwei": 30,
        "maxPriorityFeeGwei": 1,
        "maxGasPerTradeGwei": 5000000,
        "maxNotionalPerTradeUsd": 500
      }
    },
    "killSwitch": false,
    "requireTwoPersonApproval": true,
    "requireOperatorApprovalPerTrade": true
  }'::jsonb,
  true,
  1,
  'migration-035',
  'global'::policy_config_scope_type,
  NULL,
  true
WHERE NOT EXISTS (
  SELECT 1
  FROM v_policy_configurations_latest
  WHERE config_key = 'dex.limits'
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
  '035-seed-dex-live',
  'dex.live',
  '{
    "liveEnabled": false,
    "paperParallelEnabled": true,
    "chains": ["42161"],
    "maxPositionDurationMinutes": 60,
    "autoHedgeEnabled": false,
    "autoUnwindEnabled": false,
    "dryRunMode": true,
    "auditAllTrades": true
  }'::jsonb,
  true,
  1,
  'migration-035',
  'global'::policy_config_scope_type,
  NULL,
  true
WHERE NOT EXISTS (
  SELECT 1
  FROM v_policy_configurations_latest
  WHERE config_key = 'dex.live'
    AND scope_type = 'global'
    AND scope_value IS NULL
);