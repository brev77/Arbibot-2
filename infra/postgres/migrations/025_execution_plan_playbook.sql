-- Optional JSON playbook for partial-fill / settlement behaviour (P2-2.2-PLAY).
ALTER TABLE execution_plans
  ADD COLUMN IF NOT EXISTS playbook_config JSONB NULL;

COMMENT ON COLUMN execution_plans.playbook_config IS
  'Optional playbook: partialFillStrategy, driftBpsThreshold, maxPartialLegs, etc. (see docs/partial-fill-playbooks.md)';
