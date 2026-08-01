-- Migration 049: dex.limits.minNetProfitUsd seed (cost-estimation)
--
-- Adds the plan-level net-profit floor used by TradeCostEstimatorService's
-- pre-trade cost gate (evaluatePlanGate). The gate blocks LIVE plans whose
-- estimated net profit (gross − gas − slippage − pool fees − bridge fees) falls
-- below this floor; paper plans are never blocked.
--
-- Conservative default: $0.50. Operators can raise it via config-service
-- (PUT /policy/configurations/dex.limits) or the DEX_MIN_NET_PROFIT_USD env
-- override (LOWER-BOUND only — env can only tighten, never loosen; see
-- DexRiskPolicyService.applyEnvLowerBounds).
--
-- Idempotent:
--   1. If a global active `dex.limits` row exists, jsonb_set the key (only when
--      absent — never overwrites an operator-tuned value).
--   2. If no global active `dex.limits` row exists, seed one with the same
--      conservative defaults as migration 035 + the new minNetProfitUsd.
--
-- Single-writer for the value: config-service (operator / hermes-safe keys).
-- Reader: execution-orchestrator DexRiskPolicyService.getEffectiveConfig.

-- 1. Add minNetProfitUsd to existing global active dex.limits (only if absent).
--    config_value is TEXT (see migration 019), so cast to jsonb before the `?`
--    operator and jsonb_set, then cast the result back to text on assignment.
UPDATE policy_configurations
SET config_value = jsonb_set(
      config_value::jsonb,
      '{minNetProfitUsd}',
      '0.5'::jsonb,
      true  -- create_if_missing
    )::text,
    updated_at = NOW()
WHERE config_key = 'dex.limits'
  AND scope_type = 'global'
  AND scope_value IS NULL
  AND is_active = true
  AND NOT ((config_value::jsonb) ? 'minNetProfitUsd');

-- 2. Seed a global active dex.limits row if none exists yet (mirrors 035).
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
  '049-seed-dex-limits',
  'dex.limits',
  '{
    "enabled": false,
    "maxNotionalPerTradeUsd": 500,
    "maxDailyNotionalUsd": 5000,
    "maxSlippageBps": 50,
    "minNetProfitUsd": 0.5,
    "killSwitch": false,
    "requireOperatorApprovalPerTrade": true
  }'::jsonb::text,
  true,
  1,
  'migration-049',
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
