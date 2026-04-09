-- P1-1.2-AUD / P1-1.2-RISK: optional client idempotency keys (partial unique indexes).

ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_log_idempotency_key
  ON audit_log (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE risk_decisions
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

ALTER TABLE risk_decisions
  ADD COLUMN IF NOT EXISTS notional_usd NUMERIC(24, 8);

UPDATE risk_decisions
SET notional_usd = 0
WHERE notional_usd IS NULL;

ALTER TABLE risk_decisions
  ALTER COLUMN notional_usd SET NOT NULL;

ALTER TABLE risk_decisions
  ALTER COLUMN notional_usd SET DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_risk_decisions_idempotency_key
  ON risk_decisions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
