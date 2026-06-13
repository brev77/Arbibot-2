/**
 * Arbibot 2 — Fastify preHandler that enforces service-to-service HMAC auth (F1).
 *
 * Wiring:
 *   - `applyArbibotHttpSecurity` registers this preHandler when
 *     `ARBIBOT_SERVICE_AUTH_ENABLED=true` and a secret ≥32 chars is present.
 *   - When auth is enabled but the secret is missing, the server fails closed:
 *     every non-public request returns 503 (misconfiguration) and a startup log is emitted.
 *
 * Public paths (bypass): `/metrics`, `/health`, `/health/*`.
 *
 * Verified request is decorated with `serviceAuthVerified = true` and `serviceAuthTimestamp`.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  ARBIBOT_SERVICE_AUTH_HEADER,
  ARBIBOT_SERVICE_AUTH_MAX_AGE_SECONDS,
  isPathPublic,
  readServiceAuthSecret,
  verifySignature,
  type VerifyOutcome,
} from './signature';

declare module 'fastify' {
  interface FastifyRequest {
    serviceAuthVerified?: boolean;
    serviceAuthTimestamp?: number;
    serviceAuthFailureReason?: VerifyOutcome extends { ok: false; reason: infer R } ? R : never;
  }
}

export interface ServiceAuthPreHandlerOptions {
  readonly secret: string;
  /** Reference "now" for tests. */
  readonly nowSeconds?: () => number;
  readonly maxAgeSeconds?: number;
}

/**
 * Body hashing strategy. Fastify preHandler runs before route handlers and after body
 * parsing, so we hash the already-parsed body's "raw" representation when present.
 * Because the signer hashes the *exact bytes* it sent, both sides MUST agree on bytes:
 *
 *   - Outbound signer attaches the signature computed from its serialized body bytes.
 *   - Inbound verifier recomputes the SHA-256 of the body bytes that actually arrived.
 *
 * Fastify exposes `request.raw` (IncomingMessage) but the body is already consumed by the
 * parser. To stay byte-accurate without disabling body parsing, we read
 * `request.body` and re-serialize with the same JSON conventions the signer uses:
 *   - `JSON.stringify(body)` for object bodies with content-type `application/json`.
 *   - Empty string hash for `GET`/`DELETE`/no-body requests.
 *
 * If a request has a non-JSON body, configure the route to use `addContentTypeParser: '*'
 * (raw)` and ensure clients pass identical bytes; the verifier then hashes
 * `request.rawBody` when the route opts into raw parsing.
 */
function computeInboundBodyHashHex(request: FastifyRequest): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawBody = (request as any).rawBody;
  if (typeof rawBody === 'string') {
    return sha256Hex(Buffer.from(rawBody, 'utf8'));
  }
  if (rawBody instanceof Uint8Array) {
    return sha256Hex(rawBody);
  }
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'DELETE' || method === 'OPTIONS') {
    return sha256Hex(Buffer.alloc(0));
  }
  if (request.body === undefined || request.body === null) {
    return sha256Hex(Buffer.alloc(0));
  }
  if (typeof request.body === 'string') {
    return sha256Hex(Buffer.from(request.body, 'utf8'));
  }
  if (request.body instanceof Uint8Array) {
    return sha256Hex(request.body);
  }
  // JSON body — re-serialize. Signer must use identical JSON.stringify semantics.
  return sha256Hex(Buffer.from(JSON.stringify(request.body), 'utf8'));
}

import { createHash } from 'crypto';

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function createServiceAuthPreHandler(opts: ServiceAuthPreHandlerOptions) {
  const maxAge = opts.maxAgeSeconds ?? ARBIBOT_SERVICE_AUTH_MAX_AGE_SECONDS;
  return async function serviceAuthPreHandler(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const path = request.url.split('?')[0] ?? request.url;
    if (isPathPublic(path)) {
      request.serviceAuthVerified = true;
      return;
    }
    const rawHeader = request.headers[ARBIBOT_SERVICE_AUTH_HEADER] ?? undefined;
    const headerValue = Array.isArray(rawHeader) ? (rawHeader[0] ?? undefined) : rawHeader;

    const bodyHashHex = computeInboundBodyHashHex(request);
    const nowSeconds = opts.nowSeconds ? opts.nowSeconds() : Math.floor(Date.now() / 1000);
    const outcome = verifySignature(headerValue, {
      secret: opts.secret,
      method: request.method,
      pathWithQuery: request.url,
      bodyHashHex,
      nowSeconds,
      maxAgeSeconds: maxAge,
    });

    if (outcome.ok) {
      request.serviceAuthVerified = true;
      return;
    }

    request.serviceAuthVerified = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (request as any).serviceAuthFailureReason = outcome.reason;
    const status = outcome.reason === 'stale_timestamp' ? 401 : 401;
    await reply
      .status(status)
      .header('WWW-Authenticate', 'ArbibotServiceAuth')
      .send({
        error: status === 401 ? 'Unauthorized' : 'Forbidden',
        code: 'ARBIBOT_SERVICE_AUTH_FAILED',
        reason: outcome.reason,
      });
  };
}

/**
 * Returns true when service auth is configured to enforce in the current env.
 * Callers should also confirm a secret is available via `readServiceAuthSecret`.
 */
export function shouldEnableServiceAuth(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ARBIBOT_SERVICE_AUTH_ENABLED === 'true';
}

/**
 * Resolve guard configuration from env. Returns `null` when disabled.
 * Returns `{ enabled: true, secret: null }` when enabled but misconfigured (fail closed).
 */
export function resolveServiceAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): { enabled: true; secret: string | null } | { enabled: false } {
  if (!shouldEnableServiceAuth(env)) {
    return { enabled: false };
  }
  return { enabled: true, secret: readServiceAuthSecret(env) };
}