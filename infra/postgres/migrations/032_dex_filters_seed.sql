-- Seed initial DEX filters configuration
-- This configuration follows the schema defined in docs/dex-filters-config-keys.md

INSERT INTO policy_configurations (
  id,
  config_key,
  config_value,
  scope,
  environment,
  tenant_id,
  status,
  operator_id,
  created_at,
  updated_at,
  version
) VALUES (
  gen_random_uuid(),
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
  }'::jsonb,
  'global',
  NULL,
  NULL,
  'active',
  'system',
  NOW(),
  NOW(),
  1
) ON CONFLICT DO NOTHING;

-- Add comment to document the configuration
COMMENT ON TABLE policy_configurations IS 'Managed policy configurations with Redis cache and audit integration. Includes dex.filters for DEX opportunity filtering.';