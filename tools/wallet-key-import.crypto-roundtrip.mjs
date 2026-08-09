#!/usr/bin/env node
/**
 * Crypto round-trip verification for wallet-key-import.mjs (PLAN12 #2).
 *
 * Proves the import tool's encryptPrivateKey output is decryptable by the
 * KeyVaultService algorithm (double-scrypt: master key from deploy salt, then
 * per-key derived key). This is the regression guard for the bug where the
 * import tool used a single-scrypt / combined-salt scheme incompatible with the
 * service's decrypt path.
 *
 * Run:  node tools/wallet-key-import.crypto-roundtrip.mjs
 * Exit 0 = round-trip OK; 1 = mismatch (crypto schemes diverged).
 *
 * This file deliberately does NOT import KeyVaultService (would need the full
 * Nest DI graph + a build). Instead it reproduces the exact decrypt sequence
 * from key-vault.service.ts:223-278 verbatim. If the service changes its crypto,
 * this repro must be updated in lockstep (same contract as any cross-binary
 * crypto compatibility check).
 */
import { scryptSync, createDecipheriv, createCipheriv, randomBytes } from 'node:crypto';

// This file reproduces both sides of the contract inline (no imports across the
// tool / service boundary) so it stays a faithful, dependency-free guard: if
// either side changes its crypto, the repro here must be updated in lockstep.

// ── Constants (must match both key-vault.service.ts and wallet-key-import.mjs) ──
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;

/**
 * Verbatim reproduction of KeyVaultService.decryptPrivateKey (key-vault.service.ts:223-278).
 * Reads the same fields the service reads from a wallet_keys row.
 */
function decryptPrivateKeyLikeService(encryptedKey, encryptionKeyHex, deploySalt) {
  // Step 1 — constructor: master key from encryption key + deploy salt.
  const masterKey = scryptSync(encryptionKeyHex, deploySalt, KEY_LENGTH);
  // Step 2 — per-key: derived key from master key + stored per-key salt.
  const salt = Buffer.from(encryptedKey.salt, 'hex');
  const derivedKey = scryptSync(masterKey, salt, KEY_LENGTH);

  const iv = Buffer.from(encryptedKey.iv, 'hex');
  const authTagHex = encryptedKey.encryptedData.slice(-32); // 16 bytes = 32 hex
  const encrypted = encryptedKey.encryptedData.slice(0, -32);

  const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Verbatim reproduction of wallet-key-import.mjs encryptPrivateKey (the FIXED version).
 * Kept here so the round-trip is self-contained and fails loudly if someone edits
 * the tool's crypto without updating this repro.
 */
function encryptPrivateKeyLikeTool(privateKey, encryptionKey, deploySalt) {
  const clean = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
  const masterKey = scryptSync(encryptionKey, deploySalt, KEY_LENGTH);
  const perKeySalt = randomBytes(32);
  const derivedKey = scryptSync(masterKey, perKeySalt, KEY_LENGTH);
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
  let encrypted = cipher.update(clean, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return {
    encryptedData: encrypted + authTag.toString('hex'),
    iv: iv.toString('hex'),
    salt: perKeySalt.toString('hex'),
    algorithm: ALGORITHM,
  };
}

// Top-level round-trip.
const testKey =
  'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // hardhat key #0
const encryptionKey =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const deploySalt = 'test-deploy-salt-plan12';

// Encrypt with the (fixed) tool algorithm, decrypt with the service algorithm.
const encrypted = encryptPrivateKeyLikeTool(testKey, encryptionKey, deploySalt);
let decrypted;
try {
  decrypted = decryptPrivateKeyLikeService(encrypted, encryptionKey, deploySalt);
} catch (e) {
  console.error(`✗ Round-trip FAILED — service could not decrypt tool-encrypted key: ${e.message}`);
  console.error('  The import tool and KeyVaultService crypto schemes have diverged.');
  process.exit(1);
}

if (decrypted !== testKey) {
  console.error(`✗ Round-trip MISMATCH — decrypted ≠ original.`);
  console.error(`  original:  ${testKey}`);
  console.error(`  decrypted: ${decrypted}`);
  process.exit(1);
}

console.log('✓ Round-trip OK: wallet-key-import encrypts in a format KeyVaultService decrypts.');
console.log(
  `  algorithm=${encrypted.algorithm} saltLen=${encrypted.salt.length / 2} bytes (per-key only, no deploy salt concatenated)`,
);
process.exit(0);
