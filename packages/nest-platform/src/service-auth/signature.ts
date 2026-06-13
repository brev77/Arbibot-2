/**
 * Arbibot 2 — Service-to-service HMAC signature (F1 remediation).
 *
 * Design goals:
 *   1. Backward-compatible — disabled by default (env `ARBIBOT_SERVICE_AUTH_ENABLED`).
 *   2. Replay-protected — signed payload includes timestamp; verifier rejects stale timestamps.
 *   3. Body-bound — HMAC covers SHA-256 of the body so a swapped payload invalidates the signature.
 *   4. Constant-time compare — uses `crypto.timingSafeEqual` to avoid timing leaks.
 *
 * Wire format (single header `x-arbibot-signature`):
 *   t=<unixSeconds>,v1=<hex_hmac_sha256>
 *
 * Signed string (newline-joined, no trailing newline):
 *   <unixSeconds>\n<METHOD>\n<pathWithQuery>\n<bodySha256Hex>
 *
 * Notes:
 *   - Shared secret is read from env `ARBIBOT_SERVICE_AUTH_SECRET` (hex or ascii, min 32 bytes effective entropy).
 *   - Public paths (`/metrics`, `/health`, `/health/*`) bypass verification so probes still work when auth is on.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/** Header name carrying the signed timestamp + HMAC. */
export const ARBIBOT_SERVICE_AUTH_HEADER = 'x-arbibot-signature';

/** Env flag (any value other than literal `true` disables auth). */
export const ARBIBOT_SERVICE_AUTH_ENABLED_ENV = 'ARBIBOT_SERVICE_AUTH_ENABLED';

/** Env var holding the shared secret. */
export const ARBIBOT_SERVICE_AUTH_SECRET_ENV = 'ARBIBOT_SERVICE_AUTH_SECRET';

/** Max allowed clock skew / staleness in seconds (5 minutes). */
export const ARBIBOT_SERVICE_AUTH_MAX_AGE_SECONDS = 5 * 60;

/** Paths that bypass verification even when auth is enabled. */
export const ARBIBOT_SERVICE_AUTH_PUBLIC_PATHS = new Set<string>(['/metrics', '/health']);

export function isPathPublic(path: string): boolean {
  const pathOnly = path.split('?')[0] ?? '';
  if (ARBIBOT_SERVICE_AUTH_PUBLIC_PATHS.has(pathOnly)) {
    return true;
  }
  // `/health/*` subroutes (e.g. `/health/degradation`, `/health/dex`)
  return pathOnly.startsWith('/health/');
}

export function isServiceAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ARBIBOT_SERVICE_AUTH_ENABLED_ENV] === 'true';
}

/** Returns the effective shared secret or `null` if unset/too short. */
export function readServiceAuthSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env[ARBIBOT_SERVICE_AUTH_SECRET_ENV];
  if (raw === undefined || raw.length < 32) {
    return null;
  }
  return raw;
}

/**
 * Compute the canonical signed string. `bodyHashHex` must be lowercase hex SHA-256
 * of the raw request body (or empty string hash if no body).
 */
export function canonicalSigningPayload(
  timestampSeconds: number,
  method: string,
  pathWithQuery: string,
  bodyHashHex: string,
): string {
  return `${timestampSeconds}\n${method.toUpperCase()}\n${pathWithQuery}\n${bodyHashHex}`;
}

export function computeSignature(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

/** Render the header value: `t=<ts>,v1=<hex>`. */
export function renderSignatureHeader(timestampSeconds: number, hexSignature: string): string {
  return `t=${timestampSeconds},v1=${hexSignature}`;
}

export interface ParsedSignatureHeader {
  readonly timestampSeconds: number | null;
  readonly v1: string | null;
}

/** Parse `t=<ts>,v1=<hex>` defensively. Returns nulls on malformed input. */
export function parseSignatureHeader(raw: string | undefined | null): ParsedSignatureHeader {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { timestampSeconds: null, v1: null };
  }
  let timestampSeconds: number | null = null;
  let v1: string | null = null;
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (trimmed.startsWith('t=')) {
      const n = Number(trimmed.slice(2));
      if (Number.isInteger(n) && n > 0) {
        timestampSeconds = n;
      }
    } else if (trimmed.startsWith('v1=')) {
      const candidate = trimmed.slice(3);
      if (/^[0-9a-fA-F]{64}$/.test(candidate)) {
        v1 = candidate.toLowerCase();
      }
    }
  }
  return { timestampSeconds, v1 };
}

/** Constant-time hex string compare; returns false on length mismatch. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

export interface VerifyOptions {
  readonly secret: string;
  readonly method: string;
  readonly pathWithQuery: string;
  readonly bodyHashHex: string;
  /** Reference "now" in seconds; defaults to `Date.now()/1000`. Tests inject for determinism. */
  readonly nowSeconds?: number;
  readonly maxAgeSeconds?: number;
}

export type VerifyOutcome =
  | { ok: true }
  | { ok: false; reason: 'missing_header' | 'missing_fields' | 'stale_timestamp' | 'bad_signature' };

export function verifySignature(rawHeader: string | undefined | null, opts: VerifyOptions): VerifyOutcome {
  const parsed = parseSignatureHeader(rawHeader);
  if (parsed.timestampSeconds === null || parsed.v1 === null) {
    return { ok: false, reason: parsed.timestampSeconds === null && parsed.v1 === null ? 'missing_header' : 'missing_fields' };
  }
  const nowSeconds = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxAge = opts.maxAgeSeconds ?? ARBIBOT_SERVICE_AUTH_MAX_AGE_SECONDS;
  const age = Math.abs(nowSeconds - parsed.timestampSeconds);
  if (age > maxAge) {
    return { ok: false, reason: 'stale_timestamp' };
  }
  const payload = canonicalSigningPayload(
    parsed.timestampSeconds,
    opts.method,
    opts.pathWithQuery,
    opts.bodyHashHex,
  );
  const expected = computeSignature(opts.secret, payload).toLowerCase();
  if (!safeEqualHex(expected, parsed.v1)) {
    return { ok: false, reason: 'bad_signature' };
  }
  return { ok: true };
}

// ── Outbound signer (for fetch clients) ───────────────────────────────

export interface SignRequestOptions {
  readonly secret: string;
  readonly method: string;
  readonly pathWithQuery: string;
  readonly body?: string | Uint8Array | null;
  readonly nowSeconds?: number;
}

export interface SignedRequestHeaders {
  readonly header: string;
  readonly value: string;
  readonly bodyHashHex: string;
  readonly timestampSeconds: number;
}

/**
 * Produce header name + value to attach to an outbound service-to-service request.
 * Body hashing accepts a string (utf8) or raw bytes; pass `null`/`undefined` for empty body.
 */
export function signServiceRequest(opts: SignRequestOptions): SignedRequestHeaders {
  const timestampSeconds = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const bodyBytes = toBodyBytes(opts.body);
  const bodyHashHex = sha256Hex(bodyBytes);
  const payload = canonicalSigningPayload(timestampSeconds, opts.method, opts.pathWithQuery, bodyHashHex);
  const hex = computeSignature(opts.secret, payload);
  return {
    header: ARBIBOT_SERVICE_AUTH_HEADER,
    value: renderSignatureHeader(timestampSeconds, hex),
    bodyHashHex,
    timestampSeconds,
  };
}

function toBodyBytes(body: string | Uint8Array | null | undefined): Uint8Array {
  if (body === null || body === undefined) {
    return new Uint8Array(0);
  }
  if (typeof body === 'string') {
    return Buffer.from(body, 'utf8');
  }
  return body;
}

function sha256Hex(bytes: Uint8Array): string {
  // Lazy import to avoid pulling crypto at module-load for environments that don't use signing.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('crypto') as typeof import('crypto');
  return createHash('sha256').update(bytes).digest('hex');
}

/** Generate a fresh 32-byte shared secret encoded as hex (64 chars). Use to bootstrap a deployment. */
export function generateServiceAuthSecret(): string {
  return randomBytes(32).toString('hex');
}