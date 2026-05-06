-- DEX-1-2-FILL-TRACKING: change leg_id from bigint to uuid for FK alignment with execution_legs (UUID PK)
-- Step: DEX-1-2-FILL-TRACKING

ALTER TABLE on_chain_transactions
  ALTER COLUMN leg_id TYPE uuid USING leg_id::text::uuid,
  ALTER COLUMN leg_id DROP NOT NULL;