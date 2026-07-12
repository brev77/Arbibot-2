import { SignJWT, jwtVerify } from 'jose';

import type { OperatorRole } from '../operator-role';

/**
 * Signed JWT operator session — replaces the unsigned `arbibot_role` cookie (P1).
 * See `docs/adr-operator-auth.md`.
 *
 * Cookie `arbibot_session` carries a compact JWS (HS256) with claims:
 *   - `sub`  — stable operator identity (forwarded as `operatorId` to backends / audit)
 *   - `role` — 'viewer' | 'operator' | 'admin'
 *   - `iat`, `exp`, `jti`
 *
 * The secret is `OPERATOR_SESSION_SECRET` (>=32 bytes). In production it is
 * fail-closed (missing => throw, like `PRIVATE_KEY_ENCRYPTION_KEY`); in non-prod
 * a fixed dev fallback keeps local development working without configuration.
 */

export const SESSION_COOKIE = 'arbibot_session';

/** Default 8h operator-shift session lifetime. */
const DEFAULT_TTL_SECONDS = 28800;

const DEV_SESSION_SECRET =
  'dev-session-secret-insecure-do-not-use-in-production-32b';

export interface OperatorSessionClaims {
  sub: string;
  role: OperatorRole;
}

export interface SessionCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
}

function ttlSeconds(): number {
  const raw = process.env.OPERATOR_SESSION_TTL_SECONDS;
  if (raw === undefined || raw.length === 0) {
    return DEFAULT_TTL_SECONDS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TTL_SECONDS;
  }
  return parsed;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Resolve the HMAC signing secret. In production the secret MUST be provided
 * via `OPERATOR_SESSION_SECRET` (>=32 bytes) — absence is a hard failure that
 * prevents the app from signing or verifying any session (fail-closed). In
 * non-production a fixed insecure fallback is used so local dev works without
 * configuration (matches the `ARBIBOT_DEV_ROLE` dev-only philosophy).
 */
export function getSessionSecret(): string {
  const secret = process.env.OPERATOR_SESSION_SECRET;
  if (secret !== undefined && secret.length > 0) {
    return secret;
  }
  if (isProduction()) {
    throw new Error(
      'OPERATOR_SESSION_SECRET environment variable is required in production',
    );
  }
  return DEV_SESSION_SECRET;
}

function secretToKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/** Sign a new operator session JWT. */
export async function signOperatorSession(
  claims: OperatorSessionClaims,
): Promise<string> {
  const secret = getSessionSecret();
  const ttl = ttlSeconds();
  return new SignJWT({ role: claims.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .setJti(crypto.randomUUID())
    .sign(secretToKey(secret));
}

/**
 * Verify an operator session JWT. Returns the decoded claims on success, or
 * `null` when the token is missing, malformed, expired, or has an invalid
 * signature. Never throws — callers treat any verification failure as
 * "no session".
 */
export async function verifyOperatorSession(
  token: string | undefined | null,
): Promise<OperatorSessionClaims | null> {
  if (token === undefined || token === null || token.length === 0) {
    return null;
  }
  const secret = getSessionSecret();
  try {
    const { payload } = await jwtVerify(token, secretToKey(secret), {
      algorithms: ['HS256'],
    });
    const role = payload.role;
    if (
      role !== 'viewer' &&
      role !== 'operator' &&
      role !== 'admin'
    ) {
      return null;
    }
    const sub = payload.sub;
    if (typeof sub !== 'string' || sub.length === 0) {
      return null;
    }
    return { sub, role };
  } catch {
    return null;
  }
}

/** Cookie attributes for `arbibot_session` (httpOnly, secure in prod, lax). */
export function sessionCookieOptions(): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
    maxAge: ttlSeconds(),
  };
}

/** Cookie attributes to clear `arbibot_session` (logout). */
export function clearSessionCookieOptions(): Omit<SessionCookieOptions, 'maxAge'> {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
  };
}

/**
 * Constant-time string comparison for bootstrap-token verification. Avoids
 * timing side-channels when comparing the submitted token to the configured
 * secret. Returns false for differing lengths (after normalizing length so the
 * comparison time does not leak length).
 */
export function safeEqualStrings(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  // Use the longer length for both to avoid leaking which is longer via timing.
  const maxLen = Math.max(aBytes.length, bBytes.length);
  const aPadded = new Uint8Array(maxLen);
  const bPadded = new Uint8Array(maxLen);
  aPadded.set(aBytes);
  bPadded.set(bBytes);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < maxLen; i++) {
    diff |= aPadded[i]! ^ bPadded[i]!;
  }
  return diff === 0;
}

/**
 * Resolve the operator bootstrap token. In production the token MUST be
 * provided via `OPERATOR_BOOTSTRAP_TOKEN` — absence is fail-closed (callers
 * return 503). In non-production a fixed dev fallback is used.
 */
export function getBootstrapToken(): string | null {
  const token = process.env.OPERATOR_BOOTSTRAP_TOKEN;
  if (token !== undefined && token.length > 0) {
    return token;
  }
  if (isProduction()) {
    return null;
  }
  return 'dev-bootstrap-token';
}
