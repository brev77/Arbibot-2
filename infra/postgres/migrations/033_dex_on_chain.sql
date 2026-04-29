-- DEX On-Chain Entities
-- Step: DEX-1-0-MIGRATIONS
-- Purpose: Track on-chain transactions, wallet states, DEX pools, and token approvals
-- Status: Arbibot 2 DEX implementation

-- ============================================================
-- Table: on_chain_transactions
-- ============================================================
CREATE TABLE IF NOT EXISTS on_chain_transactions (
  id BIGSERIAL PRIMARY KEY,
  tx_hash VARCHAR(66) NOT NULL UNIQUE, -- 0x-prefixed 64 char hash
  chain_id INTEGER NOT NULL,
  leg_id BIGINT, -- Reference to execution_leg if applicable
  
  -- Transaction details
  from_address VARCHAR(42) NOT NULL,
  to_address VARCHAR(42) NOT NULL,
  value NUMERIC(78, 0) DEFAULT 0,
  
  -- Gas tracking
  gas_limit NUMERIC(78, 0) NOT NULL,
  gas_used NUMERIC(78, 0),
  gas_price NUMERIC(78, 0),
  max_priority_fee_per_gas NUMERIC(78, 0),
  max_fee_per_gas NUMERIC(78, 0),
  
  -- Status tracking
  status VARCHAR(32) NOT NULL DEFAULT 'pending', -- pending, confirmed, failed, reverted
  block_number BIGINT,
  block_hash VARCHAR(66),
  transaction_index INTEGER,
  
  -- Confirmation tracking
  confirmations INTEGER DEFAULT 0,
  confirmed_at TIMESTAMP WITH TIME ZONE,
  
  -- Error details
  revert_reason TEXT,
  error_message TEXT,
  
  -- Metadata
  nonce BIGINT,
  input_data BYTEA,
  
  -- Audit
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT chk_tx_hash_format CHECK (tx_hash ~ '^0x[a-fA-F0-9]{64}$'),
  CONSTRAINT chk_address_format CHECK (from_address ~ '^0x[a-fA-F0-9]{40}$' AND to_address ~ '^0x[a-fA-F0-9]{40}$'),
  CONSTRAINT chk_status CHECK (status IN ('pending', 'confirmed', 'failed', 'reverted')),
  CONSTRAINT chk_gas_used_positive CHECK (gas_used IS NULL OR gas_used >= 0),
  CONSTRAINT chk_chain_id_positive CHECK (chain_id > 0)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_on_chain_transactions_tx_hash ON on_chain_transactions(tx_hash);
CREATE INDEX IF NOT EXISTS idx_on_chain_transactions_chain_id ON on_chain_transactions(chain_id);
CREATE INDEX IF NOT EXISTS idx_on_chain_transactions_leg_id ON on_chain_transactions(leg_id);
CREATE INDEX IF NOT EXISTS idx_on_chain_transactions_status ON on_chain_transactions(status);
CREATE INDEX IF NOT EXISTS idx_on_chain_transactions_created_at ON on_chain_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_on_chain_transactions_from_address ON on_chain_transactions(from_address);
CREATE INDEX IF NOT EXISTS idx_on_chain_transactions_to_address ON on_chain_transactions(to_address);

-- Comment
COMMENT ON TABLE on_chain_transactions IS 'Tracks all on-chain transactions submitted by the system';
COMMENT ON COLUMN on_chain_transactions.leg_id IS 'Reference to execution_leg if this transaction is part of an arbitrage leg';
COMMENT ON COLUMN on_chain_transactions.status IS 'pending: submitted but not confirmed, confirmed: successfully mined, failed: transaction failed, reverted: transaction reverted on execution';

-- ============================================================
-- Table: wallet_states
-- ============================================================
CREATE TABLE IF NOT EXISTS wallet_states (
  id BIGSERIAL PRIMARY KEY,
  wallet_address VARCHAR(42) NOT NULL,
  chain_id INTEGER NOT NULL,
  
  -- Wallet configuration
  wallet_type VARCHAR(32) NOT NULL DEFAULT 'eoa', -- eoa, multisig, smart_wallet
  status VARCHAR(32) NOT NULL DEFAULT 'active', -- active, inactive, rotating, deprecated
  
  -- Nonce tracking
  nonce BIGINT NOT NULL DEFAULT 0,
  last_nonce_update TIMESTAMP WITH TIME ZONE,
  
  -- Balance tracking (optional - can be cached)
  eth_balance NUMERIC(78, 0),
  eth_balance_updated_at TIMESTAMP WITH TIME ZONE,
  
  -- Key management
  key_id VARCHAR(64) NOT NULL, -- Reference to vault key ID
  key_version INTEGER NOT NULL DEFAULT 1,
  
  -- Usage statistics
  total_transactions BIGINT DEFAULT 0,
  total_gas_used NUMERIC(78, 0) DEFAULT 0,
  total_spent NUMERIC(78, 0) DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMP WITH TIME ZONE,
  
  -- Constraints
  CONSTRAINT uk_wallet_chain UNIQUE (wallet_address, chain_id),
  CONSTRAINT chk_wallet_address CHECK (wallet_address ~ '^0x[a-fA-F0-9]{40}$'),
  CONSTRAINT chk_wallet_status CHECK (status IN ('active', 'inactive', 'rotating', 'deprecated')),
  CONSTRAINT chk_wallet_type CHECK (wallet_type IN ('eoa', 'multisig', 'smart_wallet')),
  CONSTRAINT chk_nonce_non_negative CHECK (nonce >= 0),
  CONSTRAINT chk_chain_id_positive CHECK (chain_id > 0)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_wallet_states_wallet_address ON wallet_states(wallet_address);
CREATE INDEX IF NOT EXISTS idx_wallet_states_chain_id ON wallet_states(chain_id);
CREATE INDEX IF NOT EXISTS idx_wallet_states_status ON wallet_states(status);
CREATE INDEX IF NOT EXISTS idx_wallet_states_key_id ON wallet_states(key_id);
CREATE INDEX IF NOT EXISTS idx_wallet_states_created_at ON wallet_states(created_at DESC);

-- Comment
COMMENT ON TABLE wallet_states IS 'Manages wallet states for on-chain execution';
COMMENT ON COLUMN wallet_states.key_id IS 'Reference to vault-stored private key (never stores the key itself)';
COMMENT ON COLUMN wallet_states.nonce IS 'Current nonce for this wallet on this chain';

-- ============================================================
-- Table: dex_pools
-- ============================================================
CREATE TABLE IF NOT EXISTS dex_pools (
  id BIGSERIAL PRIMARY KEY,
  pool_address VARCHAR(42) NOT NULL,
  chain_id INTEGER NOT NULL,
  
  -- DEX identification
  dex VARCHAR(32) NOT NULL, -- uniswap-v2, uniswap-v3, sushiswap
  dex_version VARCHAR(16) NOT NULL, -- v2, v3
  
  -- Pool tokens
  token_a_address VARCHAR(42) NOT NULL,
  token_b_address VARCHAR(42) NOT NULL,
  token_a_symbol VARCHAR(32),
  token_b_symbol VARCHAR(32),
  token_a_decimals INTEGER,
  token_b_decimals INTEGER,
  
  -- Pool state
  liquidity NUMERIC(78, 0), -- For V2
  fee_tier INTEGER, -- For V3 (e.g., 3000 = 0.3%)
  tick_spacing INTEGER, -- For V3
  
  -- Reserve tracking (V2)
  reserve_a NUMERIC(78, 0),
  reserve_b NUMERIC(78, 0),
  last_reserves_update TIMESTAMP WITH TIME ZONE,
  
  -- Discovery and tracking
  discovered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_checked_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT uk_pool_chain_dex UNIQUE (pool_address, chain_id, dex),
  CONSTRAINT chk_pool_address CHECK (pool_address ~ '^0x[a-fA-F0-9]{40}$'),
  CONSTRAINT chk_token_addresses CHECK (token_a_address ~ '^0x[a-fA-F0-9]{40}$' AND token_b_address ~ '^0x[a-fA-F0-9]{40}$'),
  CONSTRAINT chk_dex CHECK (dex IN ('uniswap-v2', 'uniswap-v3', 'sushiswap')),
  CONSTRAINT chk_dex_version CHECK (dex_version IN ('v2', 'v3')),
  CONSTRAINT chk_fee_tier CHECK (fee_tier IS NULL OR fee_tier > 0),
  CONSTRAINT tick_spacing CHECK (tick_spacing IS NULL OR tick_spacing > 0),
  CONSTRAINT chk_chain_id_positive CHECK (chain_id > 0)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_dex_pools_pool_address ON dex_pools(pool_address);
CREATE INDEX IF NOT EXISTS idx_dex_pools_chain_id ON dex_pools(chain_id);
CREATE INDEX IF NOT EXISTS idx_dex_pools_dex ON dex_pools(dex);
CREATE INDEX IF NOT EXISTS idx_dex_pools_token_pair ON dex_pools(token_a_address, token_b_address);
CREATE INDEX IF NOT EXISTS idx_dex_pools_is_active ON dex_pools(is_active);
CREATE INDEX IF NOT EXISTS idx_dex_pools_last_checked_at ON dex_pools(last_checked_at);

-- Comment
COMMENT ON TABLE dex_pools IS 'Discovered DEX pools for arbitrage opportunities';
COMMENT ON COLUMN dex_pools.liquidity IS 'Total pool liquidity (V2 only)';
COMMENT ON COLUMN dex_pools.fee_tier IS 'Pool fee tier in basis points (V3 only, e.g., 3000 = 0.3%)';

-- ============================================================
-- Table: approvals
-- ============================================================
CREATE TABLE IF NOT EXISTS approvals (
  id BIGSERIAL PRIMARY KEY,
  wallet_address VARCHAR(42) NOT NULL,
  chain_id INTEGER NOT NULL,
  
  -- Approval details
  token_address VARCHAR(42) NOT NULL,
  spender_address VARCHAR(42) NOT NULL,
  amount NUMERIC(78, 0) NOT NULL, -- Approved amount (use MAX_UINT256 for unlimited)
  
  -- Transaction reference
  tx_hash VARCHAR(66) UNIQUE,
  
  -- Status tracking
  status VARCHAR(32) NOT NULL DEFAULT 'pending', -- pending, approved, failed, revoked
  block_number BIGINT,
  
  -- Validity
  valid_from TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE, -- NULL means no expiration
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT uk_approval_wallet_token_spender_chain UNIQUE (wallet_address, chain_id, token_address, spender_address),
  CONSTRAINT chk_wallet_address CHECK (wallet_address ~ '^0x[a-fA-F0-9]{40}$'),
  CONSTRAINT chk_token_address CHECK (token_address ~ '^0x[a-fA-F0-9]{40}$'),
  CONSTRAINT chk_spender_address CHECK (spender_address ~ '^0x[a-fA-F0-9]{40}$'),
  CONSTRAINT chk_tx_hash_format CHECK (tx_hash ~ '^0x[a-fA-F0-9]{64}$'),
  CONSTRAINT chk_status CHECK (status IN ('pending', 'approved', 'failed', 'revoked')),
  CONSTRAINT chk_amount_non_negative CHECK (amount >= 0),
  CONSTRAINT chk_chain_id_positive CHECK (chain_id > 0)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_approvals_wallet_address ON approvals(wallet_address);
CREATE INDEX IF NOT EXISTS idx_approvals_chain_id ON approvals(chain_id);
CREATE INDEX IF NOT EXISTS idx_approvals_token_address ON approvals(token_address);
CREATE INDEX IF NOT EXISTS idx_approvals_spender_address ON approvals(spender_address);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
CREATE INDEX IF NOT EXISTS idx_approvals_tx_hash ON approvals(tx_hash);
CREATE INDEX IF NOT EXISTS idx_approvals_expires_at ON approvals(expires_at) WHERE expires_at IS NOT NULL;

-- Comment
COMMENT ON TABLE approvals IS 'Tracks token approvals for DEX spending';
COMMENT ON COLUMN approvals.amount IS 'Approved amount. For unlimited approvals, use 2^256-1';
COMMENT ON COLUMN approvals.status IS 'pending: transaction submitted, approved: transaction confirmed, failed: transaction failed, revoked: explicitly revoked';

-- ============================================================
-- Update triggers
-- ============================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
CREATE TRIGGER trigger_on_chain_transactions_updated_at
  BEFORE UPDATE ON on_chain_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_wallet_states_updated_at
  BEFORE UPDATE ON wallet_states
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_dex_pools_updated_at
  BEFORE UPDATE ON dex_pools
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_approvals_updated_at
  BEFORE UPDATE ON approvals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Initial data: Insert system wallets placeholder
-- ============================================================

-- Note: Actual wallet addresses and keys will be added via vault integration
-- This is a placeholder to ensure table structure is correct
-- Production wallets should be added securely via vault operations

-- ============================================================
-- Migration complete
-- ============================================================