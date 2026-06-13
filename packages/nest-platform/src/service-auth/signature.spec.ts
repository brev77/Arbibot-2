import { createHash, createHmac, randomBytes } from 'crypto';

import {
  ARBIBOT_SERVICE_AUTH_HEADER,
  canonicalSigningPayload,
  computeSignature,
  generateServiceAuthSecret,
  isPathPublic,
  isServiceAuthEnabled,
  parseSignatureHeader,
  readServiceAuthSecret,
  renderSignatureHeader,
  safeEqualHex,
  signServiceRequest,
  verifySignature,
} from './signature';

const SECRET = 'a'.repeat(64); // 64 hex chars = 32 bytes entropy minimum

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function bodyHashHex(body: string | null): string {
  return sha256Hex(Buffer.from(body ?? '', 'utf8'));
}

function makeHeader(
  secret: string,
  ts: number,
  method: string,
  pathWithQuery: string,
  bodyHash: string,
): string {
  const payload = canonicalSigningPayload(ts, method, pathWithQuery, bodyHash);
  const hex = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  return renderSignatureHeader(ts, hex);
}

describe('service-auth/signature', () => {
  describe('isServiceAuthEnabled', () => {
    it('returns true only for literal "true"', () => {
      expect(isServiceAuthEnabled({ ARBIBOT_SERVICE_AUTH_ENABLED: 'true' })).toBe(true);
      expect(isServiceAuthEnabled({ ARBIBOT_SERVICE_AUTH_ENABLED: 'false' })).toBe(false);
      expect(isServiceAuthEnabled({ ARBIBOT_SERVICE_AUTH_ENABLED: '1' })).toBe(false);
      expect(isServiceAuthEnabled({ ARBIBOT_SERVICE_AUTH_ENABLED: undefined })).toBe(false);
      expect(isServiceAuthEnabled({})).toBe(false);
    });
  });

  describe('readServiceAuthSecret', () => {
    it('returns null when missing or too short', () => {
      expect(readServiceAuthSecret({})).toBeNull();
      expect(readServiceAuthSecret({ ARBIBOT_SERVICE_AUTH_SECRET: 'short' })).toBeNull();
      expect(readServiceAuthSecret({ ARBIBOT_SERVICE_AUTH_SECRET: 'a'.repeat(31) })).toBeNull();
    });
    it('returns secret when at least 32 chars', () => {
      expect(readServiceAuthSecret({ ARBIBOT_SERVICE_AUTH_SECRET: 'a'.repeat(32) })).toBe('a'.repeat(32));
    });
  });

  describe('isPathPublic', () => {
    it('treats health and metrics as public', () => {
      expect(isPathPublic('/metrics')).toBe(true);
      expect(isPathPublic('/health')).toBe(true);
      expect(isPathPublic('/health/degradation')).toBe(true);
      expect(isPathPublic('/health/dex')).toBe(true);
    });
    it('treats other paths as protected', () => {
      expect(isPathPublic('/opportunities')).toBe(false);
      expect(isPathPublic('/evaluate-risk')).toBe(false);
      expect(isPathPublic('/opportunities?x=1')).toBe(false);
    });

    it('strips query string before checking (metrics stays public with query)', () => {
      expect(isPathPublic('/metrics?x=1')).toBe(true);
      expect(isPathPublic('/health?token=abc')).toBe(true);
    });
  });

  describe('parseSignatureHeader', () => {
    it('parses well-formed header', () => {
      const parsed = parseSignatureHeader('t=1000,v1=' + 'a'.repeat(64));
      expect(parsed.timestampSeconds).toBe(1000);
      expect(parsed.v1).toBe('a'.repeat(64));
    });
    it('returns nulls for empty input', () => {
      expect(parseSignatureHeader(undefined)).toEqual({ timestampSeconds: null, v1: null });
      expect(parseSignatureHeader('')).toEqual({ timestampSeconds: null, v1: null });
    });
    it('rejects malformed v1 (non-hex or wrong length)', () => {
      expect(parseSignatureHeader('t=1000,v1=xyz').v1).toBeNull();
      expect(parseSignatureHeader('t=1000,v1=' + 'a'.repeat(10)).v1).toBeNull();
    });
    it('rejects malformed timestamp', () => {
      expect(parseSignatureHeader('t=abc,v1=' + 'a'.repeat(64)).timestampSeconds).toBeNull();
    });
  });

  describe('safeEqualHex', () => {
    it('returns true for equal strings', () => {
      expect(safeEqualHex('abc', 'abc')).toBe(true);
    });
    it('returns false for different strings of same length', () => {
      expect(safeEqualHex('abc', 'abd')).toBe(false);
    });
    it('returns false for different lengths', () => {
      expect(safeEqualHex('abc', 'abcd')).toBe(false);
    });
  });

  describe('verifySignature', () => {
    const ts = 1_700_000_000;
    const method = 'POST';
    const path = '/evaluate-risk';
    const body = '{"x":1}';
    const hash = bodyHashHex(body);

    it('accepts a well-formed signature', () => {
      const header = makeHeader(SECRET, ts, method, path, hash);
      const outcome = verifySignature(header, {
        secret: SECRET,
        method,
        pathWithQuery: path,
        bodyHashHex: hash,
        nowSeconds: ts,
      });
      expect(outcome.ok).toBe(true);
    });

    it('rejects when header is missing', () => {
      const outcome = verifySignature(undefined, {
        secret: SECRET,
        method,
        pathWithQuery: path,
        bodyHashHex: hash,
        nowSeconds: ts,
      });
      expect(outcome).toEqual({ ok: false, reason: 'missing_header' });
    });

    it('rejects when fields are missing', () => {
      const outcome = verifySignature('t=1000', {
        secret: SECRET,
        method,
        pathWithQuery: path,
        bodyHashHex: hash,
        nowSeconds: ts,
      });
      expect(outcome).toEqual({ ok: false, reason: 'missing_fields' });
    });

    it('rejects stale timestamps', () => {
      const header = makeHeader(SECRET, ts, method, path, hash);
      const outcome = verifySignature(header, {
        secret: SECRET,
        method,
        pathWithQuery: path,
        bodyHashHex: hash,
        nowSeconds: ts + 10 * 60, // +10 minutes
        maxAgeSeconds: 5 * 60,
      });
      expect(outcome).toEqual({ ok: false, reason: 'stale_timestamp' });
    });

    it('rejects bad signature (different body)', () => {
      const header = makeHeader(SECRET, ts, method, path, hash);
      const outcome = verifySignature(header, {
        secret: SECRET,
        method,
        pathWithQuery: path,
        bodyHashHex: bodyHashHex('{"x":2}'),
        nowSeconds: ts,
      });
      expect(outcome).toEqual({ ok: false, reason: 'bad_signature' });
    });

    it('rejects signature made with a different secret', () => {
      const otherSecret = 'b'.repeat(64);
      const header = makeHeader(otherSecret, ts, method, path, hash);
      const outcome = verifySignature(header, {
        secret: SECRET,
        method,
        pathWithQuery: path,
        bodyHashHex: hash,
        nowSeconds: ts,
      });
      expect(outcome).toEqual({ ok: false, reason: 'bad_signature' });
    });

    it('allows small clock skew (within maxAge)', () => {
      const header = makeHeader(SECRET, ts, method, path, hash);
      const outcome = verifySignature(header, {
        secret: SECRET,
        method,
        pathWithQuery: path,
        bodyHashHex: hash,
        nowSeconds: ts + 30,
        maxAgeSeconds: 5 * 60,
      });
      expect(outcome.ok).toBe(true);
    });
  });

  describe('signServiceRequest', () => {
    it('produces a header accepted by verifySignature (round-trip)', () => {
      const body = '{"op":"create"}';
      const signed = signServiceRequest({
        secret: SECRET,
        method: 'POST',
        pathWithQuery: '/opportunities',
        body,
        nowSeconds: 1_700_000_000,
      });
      const outcome = verifySignature(signed.value, {
        secret: SECRET,
        method: 'POST',
        pathWithQuery: '/opportunities',
        bodyHashHex: signed.bodyHashHex,
        nowSeconds: 1_700_000_000,
      });
      expect(outcome.ok).toBe(true);
    });

    it('hashes empty bytes for null body', () => {
      const signed = signServiceRequest({
        secret: SECRET,
        method: 'GET',
        pathWithQuery: '/opportunities',
        body: null,
        nowSeconds: 1,
      });
      expect(signed.bodyHashHex).toBe(sha256Hex(new Uint8Array(0)));
    });

    it('uses the canonical header name', () => {
      const signed = signServiceRequest({
        secret: SECRET,
        method: 'GET',
        pathWithQuery: '/x',
        nowSeconds: 1,
      });
      expect(signed.header).toBe(ARBIBOT_SERVICE_AUTH_HEADER);
    });
  });

  describe('generateServiceAuthSecret', () => {
    it('produces a 64-char hex string usable as a secret', () => {
      const s = generateServiceAuthSecret();
      expect(s).toMatch(/^[0-9a-f]{64}$/);
      expect(readServiceAuthSecret({ ARBIBOT_SERVICE_AUTH_SECRET: s })).toBe(s);
    });
    it('produces unique values', () => {
      const a = generateServiceAuthSecret();
      const b = generateServiceAuthSecret();
      expect(a).not.toBe(b);
    });
  });

  describe('computeSignature determinism', () => {
    it('is stable for identical inputs', () => {
      const sigA = computeSignature(SECRET, '1\nPOST\n/x\n' + bodyHashHex('a'));
      const sigB = computeSignature(SECRET, '1\nPOST\n/x\n' + bodyHashHex('a'));
      expect(sigA).toBe(sigB);
    });
    it('changes when method changes', () => {
      const sigPost = computeSignature(SECRET, '1\nPOST\n/x\n' + bodyHashHex(''));
      const sigGet = computeSignature(SECRET, '1\nGET\n/x\n' + bodyHashHex(''));
      expect(sigPost).not.toBe(sigGet);
    });
  });

  it('random secret round-trips through sign+verify', () => {
    const secret = randomBytes(32).toString('hex');
    const signed = signServiceRequest({
      secret,
      method: 'PUT',
      pathWithQuery: '/items/42?ts=1',
      body: '{"k":"v"}',
      nowSeconds: 1_700_000_000,
    });
    const outcome = verifySignature(signed.value, {
      secret,
      method: 'PUT',
      pathWithQuery: '/items/42?ts=1',
      bodyHashHex: signed.bodyHashHex,
      nowSeconds: 1_700_000_000,
    });
    expect(outcome.ok).toBe(true);
  });
});