-- Migration 042: wallet_keys — persist AES-256-GCM encrypted private keys (D4-B-4-KEYS, L4)
--
-- Replaces the in-memory `encryptedKeys` Map in KeyVaultService so encrypted wallet
-- keys survive process restarts. The row stores ONLY the AES-256-GCM ciphertext blob
-- (encrypted_data = ciphertext+authTag), iv, salt and algorithm — never the plaintext
-- private key. The master encryption key (PRIVATE_KEY_ENCRYPTION_KEY) lives in the
-- environment / Vault and is never persisted to this table.
--
-- Single-writer: execution-orchestrator (KeyVaultService via WalletKeyStore adapter).
-- Readers: KeyVaultService.retrieveEncryptedKey (on-demand decrypt), dex-health.
--
-- Backup note: this table is encrypted-at-rest, but should be excluded from the
-- standard logical dump (`pg_dump --exclude-table=wallet_keys`) and kept in a
-- separately managed encrypted backup, because it is key material.
--
-- Phase C (live): the ciphertext may instead be produced by HashiCorp Vault Transit
-- Engine (envelope encryption). See docs/vault-integration-guide.md §3.3, §6.

CREATE TABLE IF NOT EXISTS wallet_keys (
    key_id          TEXT PRIMARY KEY,
    address         VARCHAR(42) NOT NULL,
    chain_id        INTEGER NOT NULL,

    -- Lifecycle
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,

    -- AES-256-GCM ciphertext blob (ciphertext + 16-byte authTag as hex). Never plaintext.
    encrypted_data  TEXT NOT NULL,
    iv              TEXT NOT NULL,
    salt            TEXT NOT NULL,
    algorithm       VARCHAR(32) NOT NULL DEFAULT 'aes-256-gcm',

    -- Timestamps
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at    TIMESTAMPTZ,

    CONSTRAINT chk_wallet_keys_address CHECK (address ~ '^0x[a-fA-F0-9]{40}$'),
    CONSTRAINT chk_wallet_keys_chain_id_positive CHECK (chain_id > 0),
    CONSTRAINT chk_wallet_keys_iv_hex CHECK (iv ~ '^[0-9a-fA-F]+$'),
    CONSTRAINT chk_wallet_keys_salt_hex CHECK (salt ~ '^[0-9a-fA-F]+$')
);

-- Lookups by chain (wallet selection) and active-state (health checks).
CREATE INDEX IF NOT EXISTS idx_wallet_keys_chain_id ON wallet_keys (chain_id);
CREATE INDEX IF NOT EXISTS idx_wallet_keys_is_active ON wallet_keys (is_active);

-- updated_at maintenance (shared function defined in migration 033).
CREATE TRIGGER trigger_wallet_keys_updated_at
    BEFORE UPDATE ON wallet_keys
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE wallet_keys IS
    'AES-256-GCM encrypted wallet private keys (D4-B-4-KEYS, single-writer: execution-orchestrator). Master key in env/Vault, never in this table.';
COMMENT ON COLUMN wallet_keys.key_id IS 'Stable identifier matching wallet_states.key_id (reference to vault-stored key).';
COMMENT ON COLUMN wallet_keys.address IS 'Checksum/lowercase EVM address (0x-prefixed 40 hex).';
COMMENT ON COLUMN wallet_keys.encrypted_data IS 'AES-256-GCM ciphertext (hex) concatenated with the 16-byte GCM auth tag (hex). NEVER stores plaintext.';
COMMENT ON COLUMN wallet_keys.iv IS 'Initialization vector for this key (hex, 16 bytes).';
COMMENT ON COLUMN wallet_keys.salt IS 'Per-key scrypt salt (hex, 32 bytes) mixed with the master encryption key.';
COMMENT ON COLUMN wallet_keys.algorithm IS 'Cipher algorithm. Currently aes-256-gcm.';
COMMENT ON COLUMN wallet_keys.is_active IS 'Soft-delete / rotation flag. Inactive keys are excluded from wallet selection.';
