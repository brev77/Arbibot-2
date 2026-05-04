-- Seed initial DEX filters configuration
-- This configuration follows the schema defined in docs/dex-filters-config-keys.md
-- Uses the same idempotent pattern as 029_intake_policy_seed.sql

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
  '032-seed-dex-filters',
  'dex.filters',
  '{
    "enabled": true,
    "filters": {
      "minSpreadPct": {
        "enabled": true,
        "value": 0.5
      },
      "minProfitUsd": {
        "enabled": true,
        "value": 100
      },
      "maxFeesUsd": {
        "enabled": true,
        "value": 50
      },
      "volumeRange": {
        "enabled": true,
        "min": 10000,
        "max": 1000000
      },
      "blacklistTokens": {
        "enabled": false,
        "tokens": []
      },
      "allowedChains": {
        "enabled": false,
        "chains": []
      },
      "quoteAssets": {
        "enabled": true,
        "assets": ["USDT", "USDC", "WETH", "WBTC"]
      },
      "highRisk": {
        "enabled": true,
        "maxRiskLevel": "medium"
      }
    }
  }',
  false,
  1,
  'migration-032',
  'global'::policy_config_scope_type,
  NULL,
  true
WHERE NOT EXISTS (
  SELECT 1
  FROM v_policy_configurations_latest
  WHERE config_key = 'dex.filters'
    AND scope_type = 'global'
    AND scope_value IS NULL
);