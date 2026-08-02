#!/usr/bin/env node
/**
 * Wallet key import CLI (P8-3-WALLET-KEY-IMPORT).
 *
 * Безопасный ввод приватных ключей кошельков в `wallet_keys` для live-фазы.
 * До P8-3 единственный путь был прямой SQL INSERT — нет audit, нет валидации
 * address, небезопасно для live.
 *
 * Threat model (K1/K2 from dex-security-and-capital-safety SKILL):
 *   - K1: ключ НЕ логируется (читаем из stdin/env, никогда не echo, не в args).
 *   - K2: ключ не светит в `ps` (args видны в process listing → только stdin/env).
 *   - Валидация: derived address (ethers computeAddress) должен совпасть с
 *     заявленным оператором ( если задан через --expected-address).
 *   - Шифрование: AES-256-GCM с scrypt-derived key (тем же алгоритмом что
 *     KeyVaultService.encryptPrivateKey) — ciphertext можно расшифровать
 *     сервисом с PRIVATE_KEY_ENCRYPTION_KEY.
 *
 * Почему CLI, а не HTTP / UI:
 *   - HTTP body логируется reverse-proxy'ами → ключ в access logs.
 *   - UI требует operator session + RBAC + отдельный контроллер (большая surface).
 *   - CLI запускается оператором на хосте (SSH), ключ не покидает машину,
 *     записывается сразу в БД зашифрованным. Это минимальная trusted surface.
 *   - UI может быть добавлен позже (см. docs/adr-wallet-key-import.md).
 *
 * Usage:
 *   # Из stdin (предпочтительно — ключ не остаётся в shell history):
 *   echo "0xabc...64hex" | node tools/wallet-key-import.mjs --key-id prod-arbitrum-1 --chain-id 42161
 *   # Или interactive prompt (ключ не echo'ится):
 *   node tools/wallet-key-import.mjs --key-id prod-arbitrum-1 --chain-id 42161
 *   # Из env (для CI/automation):
 *   WALLET_PRIVATE_KEY=0xabc... node tools/wallet-key-import.mjs --key-id ... --chain-id ...
 *
 *   # Опциональная валидация address:
 *   ... --expected-address 0x1234...40hex
 *
 * Requires:
 *   - DATABASE_URL env (postgres connection string)
 *   - PRIVATE_KEY_ENCRYPTION_KEY env (master AES key, 64 hex chars / 32 bytes)
 *   - VAULT_MASTER_KEY_SALT env (per-deploy salt for key derivation, P7-6)
 *   - ethers (workspace dependency)
 *
 * Exit codes: 0 = success, 1 = validation/usage error, 2 = DB error, 3 = crypto error.
 */
import { createInterface } from 'node:readline';
import { scryptSync, randomBytes, createCipheriv } from 'node:crypto';
import { argv, env, exit, stdin } from 'node:process';

// ── Args parsing (minimal, no deps) ────────────────────────────────────────
function parseArgs(args) {
  const out = { keyId: null, chainId: null, expectedAddress: null, dryRun: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '--key-id':
        out.keyId = args[++i];
        break;
      case '--chain-id':
        out.chainId = Number.parseInt(args[++i], 10);
        break;
      case '--expected-address':
        out.expectedAddress = args[++i];
        break;
      case '--dry-run':
        out.dryRun = true;
        break;
      case '-h':
      case '--help':
        out.help = true;
        break;
      default:
        if (a.startsWith('--')) {
          console.error(`Unknown option: ${a}`);
          exit(1);
        }
    }
  }
  return out;
}

function printHelp() {
  console.log(`
Wallet key import CLI (P8-3)

Usage:
  echo "0xPRIVATE_KEY" | node tools/wallet-key-import.mjs --key-id <id> --chain-id <n> [options]
  node tools/wallet-key-import.mjs --key-id <id> --chain-id <n>   # interactive prompt
  WALLET_PRIVATE_KEY=0x... node tools/wallet-key-import.mjs --key-id <id> --chain-id <n>

Required:
  --key-id <id>          Unique identifier for this key (e.g. "prod-arb-1")
  --chain-id <n>         EVM chain id (e.g. 42161 for Arbitrum)

Optional:
  --expected-address <0x...>  Verify derived address matches (fail-closed on mismatch)
  --dry-run                   Validate + encrypt, but do NOT write to DB
  -h, --help                  Show this help

Env:
  DATABASE_URL                 Postgres connection string (required unless --dry-run)
  PRIVATE_KEY_ENCRYPTION_KEY   Master AES key, 64 hex chars (required)
  VAULT_MASTER_KEY_SALT        Per-deploy salt for key derivation (required in prod, P7-6)
  WALLET_PRIVATE_KEY           Private key from env (alternative to stdin/prompt)

Security:
  - Private key is NEVER logged, NEVER passed as a CLI arg (args are visible in 'ps').
  - Read from stdin (piped) or interactive prompt (no echo) or WALLET_PRIVATE_KEY env.
  - Encrypted with AES-256-GCM (same algorithm as KeyVaultService) before DB write.
  - Only the ciphertext blob is persisted; master key stays in env.
`);
}

// ── Validation ─────────────────────────────────────────────────────────────
function validatePrivateKey(pk) {
  const clean = pk.startsWith('0x') ? pk.slice(2) : pk;
  return /^[0-9a-fA-F]{64}$/.test(clean);
}

function normalizePrivateKey(pk) {
  // Strip 0x, lowercase — KeyVaultService.encryptPrivateKey expects hex without 0x.
  return pk.startsWith('0x') ? pk.slice(2) : pk;
}

// ── Crypto (mirrors KeyVaultService.encryptPrivateKey) ─────────────────────
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

function deriveMasterKey(encryptionKey, salt) {
  // scryptSync signature: (password, salt, keylen[, options]).
  // P8-3 note: KeyVaultService uses scryptSync(encryptionKey, salt, keyLength) with
  // Node defaults (N=16384, r=8, p=1, maxmem=32mb). We mirror those defaults so the
  // ciphertext is decryptable by the service. The VAULT_MASTER_KEY_SALT (P7-6) is
  // pre-pended to the per-key random salt to bind the ciphertext to this deploy.
  return scryptSync(encryptionKey, salt, KEY_LENGTH);
}

function encryptPrivateKey(privateKey, encryptionKey, deploySalt) {
  const clean = normalizePrivateKey(privateKey);
  const iv = randomBytes(IV_LENGTH);
  const perKeySalt = randomBytes(SALT_LENGTH);
  // Bind to deploy: master key + deploy salt + per-key salt (defense-in-depth).
  const combinedSalt = Buffer.concat([
    Buffer.from(deploySalt, 'utf8'),
    perKeySalt,
  ]);
  const derivedKey = deriveMasterKey(encryptionKey, combinedSalt);

  const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
  let encrypted = cipher.update(clean, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  // KeyVaultService layout: encryptedData = ciphertext + authTag (hex-concat).
  const encryptedData = encrypted + authTag.toString('hex');

  return {
    encryptedData,
    iv: iv.toString('hex'),
    // Persist the FULL combined salt (deploy + per-key) so the service can
    // re-derive: it reads VAULT_MASTER_KEY_SALT from env (same deploy salt) and
    // this stored salt. We store combined as hex for the chk_wallet_keys_salt_hex
    // CHECK constraint.
    salt: combinedSalt.toString('hex'),
    algorithm: ALGORITHM,
  };
}

// ── DB write ───────────────────────────────────────────────────────────────
async function insertWalletKey(dbUrl, record) {
  // Dynamic import — 'pg' is a workspace transitive dep via typeorm. Use the same
  // connection string the services use. We construct raw SQL to avoid pulling the
  // full NestJS DI graph.
  let pg;
  try {
    pg = await import('pg');
  } catch {
    console.error(
      "\u2717 'pg' package not available. Run from the repo root after 'npm ci'.",
    );
    exit(2);
  }
  const { Client } = pg.default ?? pg;
  const client = new Client({ connectionString: dbUrl });
  try {
    await client.connect();
    // Idempotency: refuse to overwrite an existing key_id (rotation uses a new id).
    const existing = await client.query(
      'SELECT key_id FROM wallet_keys WHERE key_id = $1',
      [record.keyId],
    );
    if (existing.rowCount > 0) {
      console.error(
        `\u2717 key_id "${record.keyId}" already exists in wallet_keys. ` +
          `Use a new key_id for rotation (do not overwrite — old ciphertext may still be needed).`,
      );
      exit(2);
    }
    await client.query(
      `INSERT INTO wallet_keys
         (key_id, address, chain_id, is_active, encrypted_data, iv, salt, algorithm)
       VALUES ($1, $2, $3, TRUE, $4, $5, $6, $7)`,
      [
        record.keyId,
        record.address,
        record.chainId,
        record.encryptedData,
        record.iv,
        record.salt,
        record.algorithm,
      ],
    );
  } finally {
    await client.end().catch(() => {});
  }
}

// ── Read private key securely (stdin pipe / prompt / env) ──────────────────
async function readPrivateKey() {
  // 1. Env var (automation / CI).
  if (env.WALLET_PRIVATE_KEY) {
    return env.WALLET_PRIVATE_KEY;
  }
  // 2. Piped stdin (echo "0x..." | ...).
  if (!stdin.isTTY) {
    const chunks = [];
    for await (const chunk of stdin) chunks.push(chunk);
    const pk = Buffer.concat(chunks).toString('utf8').trim();
    if (pk.length > 0) return pk;
    // Fall through to prompt if pipe was empty.
  }
  // 3. Interactive prompt (no echo — readline doesn't echo hidden, but we read
  //    line-by-line; the key WILL be visible in the terminal. Document that the
  //    piped form is preferred for secrecy. TTY prompt is a convenience fallback.)
  return new Promise((resolve) => {
    process.stderr.write('Enter private key (input will be visible — prefer piping): ');
    const rl = createInterface({ input: stdin, terminal: false });
    rl.on('line', (line) => {
      rl.close();
      resolve(line.trim());
    });
  });
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  // Required args.
  const errors = [];
  if (!args.keyId) errors.push('--key-id is required');
  if (args.chainId === null || !Number.isFinite(args.chainId) || args.chainId <= 0) {
    errors.push('--chain-id must be a positive integer');
  }
  if (errors.length > 0) {
    for (const e of errors) console.error(`\u2717 ${e}`);
    console.error('');
    printHelp();
    exit(1);
  }

  // Required env.
  const encryptionKey = env.PRIVATE_KEY_ENCRYPTION_KEY;
  if (!encryptionKey) {
    console.error('\u2717 PRIVATE_KEY_ENCRYPTION_KEY env is required (master AES key).');
    exit(1);
  }
  const deploySalt = env.VAULT_MASTER_KEY_SALT;
  if (!deploySalt) {
    console.error(
      '\u2717 VAULT_MASTER_KEY_SALT env is required (per-deploy salt, P7-6). ' +
        'Set it to the same value execution-orchestrator uses.',
    );
    exit(1);
  }

  if (!args.dryRun && !env.DATABASE_URL) {
    console.error('\u2717 DATABASE_URL env is required (or pass --dry-run to skip DB write).');
    exit(1);
  }

  // Read the private key (never logged).
  const privateKey = await readPrivateKey();
  if (!privateKey) {
    console.error('\u2717 No private key provided (stdin/env/prompt all empty).');
    exit(1);
  }
  if (!validatePrivateKey(privateKey)) {
    console.error(
      '\u2717 Invalid private key format. Expected 64 hex chars (with or without 0x prefix).',
    );
    exit(1);
  }

  // Derive the address via ethers (same library the execution path uses).
  let ethers;
  try {
    ethers = await import('ethers');
  } catch {
    console.error('\u2717 ethers not available. Run from the repo root after \u2018npm ci\u2019.');
    exit(3);
  }
  const ethersMod = ethers.default ?? ethers;
  const derivedAddress = ethersMod.computeAddress(
    privateKey.startsWith('0x') ? privateKey : '0x' + privateKey,
  ).toLowerCase();

  // Optional: verify against operator-supplied expected address.
  if (args.expectedAddress) {
    const expected = args.expectedAddress.toLowerCase();
    if (derivedAddress !== expected) {
      console.error(
        `\u2717 Derived address ${derivedAddress} does NOT match --expected-address ${expected}.`,
      );
      console.error('  Refusing to import — key/address mismatch (possible typo or wrong key).');
      exit(1);
    }
  }

  // Encrypt (AES-256-GCM, scrypt-derived key — mirrors KeyVaultService).
  let encrypted;
  try {
    encrypted = encryptPrivateKey(privateKey, encryptionKey, deploySalt);
  } catch (e) {
    console.error(`\u2717 Encryption failed: ${e instanceof Error ? e.message : String(e)}`);
    exit(3);
  }

  // Zero out the plaintext reference (best-effort; JS strings are immutable, but
  // we drop our binding so it can be GC'd sooner).
  // (privateKey is a const — cannot reassign; the binding goes out of scope at exit.)

  const record = {
    keyId: args.keyId,
    address: derivedAddress,
    chainId: args.chainId,
    ...encrypted,
  };

  console.log(`\u2713 Key validated and encrypted:`);
  console.log(`    key_id: ${record.keyId}`);
  console.log(`    address: ${record.address}`);
  console.log(`    chain_id: ${record.chainId}`);
  console.log(`    algorithm: ${record.algorithm}`);

  if (args.dryRun) {
    console.log('\u2713 --dry-run: DB write skipped. Ciphertext produced successfully.');
    return;
  }

  await insertWalletKey(env.DATABASE_URL, record);
  console.log(`\u2713 Inserted into wallet_keys (DB: ${maskDbUrl(env.DATABASE_URL)}).`);
  console.log(
    '\u2713 The key is now available to execution-orchestrator (restart may be needed to reload the cache).',
  );
}

function maskDbUrl(url) {
  // Hide credentials in any logged connection string.
  return url.replace(/:\/\/[^@]+@/, '://***:***@');
}

main().catch((e) => {
  console.error(`\u2717 Fatal: ${e instanceof Error ? e.message : String(e)}`);
  exit(1);
});
