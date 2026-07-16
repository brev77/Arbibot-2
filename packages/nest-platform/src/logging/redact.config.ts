/**
 * pino redact paths — sensitive fields that must never reach log output.
 *
 * Extends the K1 guard from `tools/ci-key-leakage.sh` (which catches *literal* key
 * leaks and logging named key variables) to cover *object-property* leaks: any
 * object passed to the logger that contains one of these paths has the value
 * replaced with `[Redacted]` at serialisation time, before the line is written.
 *
 * Paths use pino's dot-and-bracket syntax. Wildcards (`*`) match any single key
 * at that level. Keep this list in sync with new sensitive fields as they are
 * introduced; `ci-key-leakage` (D4-B-7) is the static-pattern backstop.
 *
 * Threat IDs from `.cursor/skills/dex-security-and-capital-safety/SKILL.md`:
 *   K1.1 — wallet key material in log payload
 *   K1.2 — auth secrets (API keys, bearer tokens) in log payload
 */
export const ARBIBOT_LOG_REDACT_PATHS: ReadonlyArray<string> = [
  // K1.1 — wallet / key material. Both top-level (`privateKey`) and one-nested
  // (`wallet.privateKey`) forms, because log payloads arrive both shapes.
  'privateKey',
  'mnemonic',
  'signingKey',
  'decryptedKey',
  'rawKey',
  'encryptedKey',
  'seedPhrase',
  '*.privateKey',
  '*.mnemonic',
  '*.signingKey',
  '*.decryptedKey',
  '*.rawKey',
  '*.encryptedKey',
  '*.seedPhrase',
  // K1.2 — auth secrets. Same dual-shape coverage.
  'secret',
  'apiKey',
  'api_key',
  'authorization',
  'password',
  'token',
  '*.secret',
  '*.apiKey',
  '*.api_key',
  '*.authorization',
  '*.password',
  '*.token',
  // HTTP request/response envelopes (pino-http-style `req`/`res` objects).
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-hermes-api-key"]',
  'req.headers["x-correlation-id"]',
  'res.headers["set-cookie"]',
] as const;

/** Censor string used by pino redact. */
export const ARBIBOT_REDACT_CENSOR = '[Redacted]';
