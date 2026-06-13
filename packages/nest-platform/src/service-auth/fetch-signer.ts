/**
 * Arbibot 2 — Outbound fetch wrapper that signs service-to-service requests (F1).
 *
 * Usage:
 *   const response = await signedFetch('http://risk-service:3000/evaluate-risk', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify(payload),
 *   });
 *
 * When `ARBIBOT_SERVICE_AUTH_ENABLED=true` and a secret is configured, the wrapper
 * attaches `x-arbibot-signature`. When disabled, it is a plain `fetch` passthrough.
 *
 * The wrapper deterministically serializes the body so the inbound verifier
 * recomputes the same SHA-256. To preserve byte-accuracy:
 *   - Pass `body` as a string (preferred) — the bytes you pass are the bytes signed.
 *   - Pass `body` as `Uint8Array` — signed as-is.
 *   - Do NOT pass objects — caller must JSON.stringify first so caller and verifier agree.
 */

import {
  isServiceAuthEnabled,
  readServiceAuthSecret,
  signServiceRequest,
  type SignedRequestHeaders,
} from './signature';

export interface SignedFetchInit extends RequestInit {
  /**
   * If true, signing is forced on even if env is disabled (e.g. per-call override).
   * Default: derived from env.
   */
  readonly forceSign?: boolean;
  /**
   * Override secret for tests. Production code should rely on env.
   */
  readonly secret?: string;
}

function effectiveSecret(explicit?: string): string | null {
  if (explicit !== undefined) {
    return explicit.length >= 32 ? explicit : null;
  }
  return readServiceAuthSecret();
}

/**
 * Sign and send a service-to-service request. The returned promise resolves with the
 * native `Response`. Network errors propagate from `fetch`.
 *
 * Implementation notes:
 *   - `RequestInit.body` for fetch is `BodyInit | null`. We accept string / Uint8Array
 *     because those are what service-to-service callers in this repo use (JSON payloads).
 *   - For `GET`/`DELETE`/no-body requests, body hashing uses empty bytes.
 */
export async function signedFetch(input: string | URL, init: SignedFetchInit = {}): Promise<Response> {
  const url = typeof input === 'string' ? input : input.toString();
  const method = (init.method ?? 'GET').toUpperCase();

  const sign = init.forceSign ?? isServiceAuthEnabled();
  if (!sign) {
    return fetch(input, init);
  }

  const secret = effectiveSecret(init.secret);
  if (secret === null) {
    // Fail loud — caller enabled signing but no secret is configured.
    throw new Error(
      'signedFetch: ARBIBOT_SERVICE_AUTH_ENABLED=true but ARBIBOT_SERVICE_AUTH_SECRET is unset or <32 chars',
    );
  }

  // Build the pathWithQuery from the URL (must match what the server sees, including query).
  const parsed = new URL(url);
  const pathWithQuery = parsed.pathname + (parsed.search ? parsed.search : '');

  // Normalize body to bytes for signing.
  const bodyBytes = bodyToBytes(init.body);
  const headers = new Headers(init.headers);

  const signed: SignedRequestHeaders = signServiceRequest({
    secret,
    method,
    pathWithQuery,
    body: bodyBytes,
  });

  // Attach signature + body hash header (verifier can compare when raw-body parsing is enabled).
  headers.set(signed.header, signed.value);
  headers.set('x-arbibot-body-sha256', signed.bodyHashHex);

  return fetch(input, { ...init, headers });
}

function bodyToBytes(body: BodyInit | null | undefined): Uint8Array | null {
  if (body === null || body === undefined) {
    return null;
  }
  if (typeof body === 'string') {
    return Buffer.from(body, 'utf8');
  }
  if (body instanceof Uint8Array) {
    return body;
  }
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    // We cannot synchronously hash a stream without consuming it; reject to keep signature deterministic.
    throw new Error('signedFetch: streaming bodies are not supported — pass string or Uint8Array');
  }
  if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) {
    return new Uint8Array(body);
  }
  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  // Unknown body type — fail closed to avoid unsigned traffic.
  throw new Error(`signedFetch: unsupported body type ${typeof body}`);
}