-- Migration 045: seed config keys for scanner-service (cross-DEX detector).
-- Idempotent: skips if an active global row already exists for the key (see v_policy_configurations_latest).
-- Mirror of 035_dex_live_limits_seed.sql pattern.
--
-- Keys:
--   scanner.defaults   — global fallback filters + RPC budget defaults + findings retention
--   scanner.instances  — array of instance DEFINITIONS (network, strategy, interval, filters, enabled)
--
-- Single-writer for these keys: config-service. scanner-service READS them (TTL cache).
-- scanner_instances TABLE (migration 044) holds only RUNTIME status, NOT this configuration.

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
  '045-seed-scanner-defaults',
  'scanner.defaults',
  '{
    "findingsRetentionDays": 7,
    "rpcRateLimitRps": 10,
    "poolCacheTtlMs": 30000,
    "dedupCooldownMs": 60000,
    "orphanRetryIntervalMs": 60000,
    "orphanMaxAttempts": 5,
    "opportunityPublishTimeoutMs": 5000,
    "defaultFilters": {
      "minSpreadBps": 30,
      "minLiquidityUsd": 50000,
      "volumeRange": { "enabled": false, "min1hUsd": 0, "max24hUsd": 0 },
      "blacklistTokens": [],
      "allowedChains": [42161, 8453, 56],
      "quoteAssets": ["WETH", "USDC", "USDT"]
    }
  }'::jsonb,
  false,
  1,
  'migration-045',
  'global'::policy_config_scope_type,
  NULL,
  true
WHERE NOT EXISTS (
  SELECT 1
  FROM v_policy_configurations_latest
  WHERE config_key = 'scanner.defaults'
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
  '045-seed-scanner-instances',
  'scanner.instances',
  '{
    "instances": []
  }'::jsonb,
  false,
  1,
  'migration-045',
  'global'::policy_config_scope_type,
  NULL,
  true
WHERE NOT EXISTS (
  SELECT 1
  FROM v_policy_configurations_latest
  WHERE config_key = 'scanner.instances'
    AND scope_type = 'global'
    AND scope_value IS NULL
);
