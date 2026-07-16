import { createHash } from 'crypto';

import { signedFetch } from './fetch-signer';
import { ARBIBOT_SERVICE_AUTH_HEADER, verifySignature } from './signature';

const SECRET = 'a'.repeat(64); // 64 hex chars = 32 bytes entropy minimum

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('service-auth/fetch-signer (signedFetch)', () => {
  const originalFetch = global.fetch;
  // Snapshot env so each test controls the signer configuration deterministically.
  const originalEnv = { ...process.env };

  let fetchMock: jest.Mock;
  let lastInit: RequestInit | undefined;
  let lastUrl: string | URL | Request | undefined;

  function installFetch(status = 200): void {
    fetchMock = jest.fn(() =>
      Promise.resolve(
        new Response('{}', {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    global.fetch = fetchMock as typeof fetch;
  }

  function captureCall(): void {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // signedFetch(input, init) — second positional arg is the init.
    lastUrl = fetchMock.mock.calls[0][0] as string | URL | Request;
    lastInit = fetchMock.mock.calls[0][1] as RequestInit | undefined;
  }

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ARBIBOT_SERVICE_AUTH_ENABLED;
    delete process.env.ARBIBOT_SERVICE_AUTH_SECRET;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it('is an unsigned passthrough when auth is disabled (no signature header added)', async () => {
    installFetch();
    await signedFetch('http://risk-service:3000/evaluate-risk', {
      method: 'POST',
      body: '{"x":1}',
    });
    captureCall();
    const headers = new Headers(lastInit?.headers);
    expect(headers.has(ARBIBOT_SERVICE_AUTH_HEADER)).toBe(false);
    expect(headers.has('x-arbibot-body-sha256')).toBe(false);
    // Body and URL are forwarded unchanged.
    expect(lastInit?.body).toBe('{"x":1}');
    expect(lastUrl).toBe('http://risk-service:3000/evaluate-risk');
  });

  it('attaches x-arbibot-signature + x-arbibot-body-sha256 when enabled', async () => {
    process.env.ARBIBOT_SERVICE_AUTH_ENABLED = 'true';
    process.env.ARBIBOT_SERVICE_AUTH_SECRET = SECRET;
    installFetch();

    await signedFetch('http://config-service:3019/policy/configurations/x/effective', {
      method: 'POST',
      body: '{"k":"v"}',
    });
    captureCall();

    const headers = new Headers(lastInit?.headers);
    const sig = headers.get(ARBIBOT_SERVICE_AUTH_HEADER);
    const bodyHash = headers.get('x-arbibot-body-sha256');
    expect(sig).not.toBeNull();
    expect(bodyHash).toBe(sha256Hex(Buffer.from('{"k":"v"}', 'utf8')));
    expect(sig).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);

    // The signature must verify against the actual body bytes.
    const outcome = verifySignature(sig, {
      secret: SECRET,
      method: 'POST',
      pathWithQuery: '/policy/configurations/x/effective',
      bodyHashHex: bodyHash!,
      maxAgeSeconds: 5 * 60,
    });
    expect(outcome.ok).toBe(true);
  });

  it('hashes empty bytes for GET requests (no body)', async () => {
    process.env.ARBIBOT_SERVICE_AUTH_ENABLED = 'true';
    process.env.ARBIBOT_SERVICE_AUTH_SECRET = SECRET;
    installFetch();

    await signedFetch('http://risk-service:3000/risk-decisions/42', { method: 'GET' });
    captureCall();

    const headers = new Headers(lastInit?.headers);
    expect(headers.get('x-arbibot-body-sha256')).toBe(sha256Hex(new Uint8Array(0)));
  });

  it('throws (fail-closed) when enabled but the secret is unset', async () => {
    process.env.ARBIBOT_SERVICE_AUTH_ENABLED = 'true';
    // secret intentionally unset
    installFetch();

    await expect(
      signedFetch('http://risk-service:3000/x', { method: 'GET' }),
    ).rejects.toThrow(/ARBIBOT_SERVICE_AUTH_SECRET/);
    // Must NOT have made an unsigned call.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when enabled but the secret is too short (<32 chars)', async () => {
    process.env.ARBIBOT_SERVICE_AUTH_ENABLED = 'true';
    process.env.ARBIBOT_SERVICE_AUTH_SECRET = 'short';
    installFetch();

    await expect(
      signedFetch('http://risk-service:3000/x', { method: 'GET' }),
    ).rejects.toThrow(/ARBIBOT_SERVICE_AUTH_SECRET/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forceSign=true signs even when env is disabled', async () => {
    // env disabled, but caller forces signing (e.g. hermes HERMES_SIGN_UPSTREAM=true)
    process.env.ARBIBOT_SERVICE_AUTH_SECRET = SECRET;
    installFetch();

    await signedFetch('http://capital-service:3011/capital/reservations/1', {
      method: 'GET',
      forceSign: true,
    });
    captureCall();
    const headers = new Headers(lastInit?.headers);
    expect(headers.has(ARBIBOT_SERVICE_AUTH_HEADER)).toBe(true);
  });

  it('accepts a Uint8Array body and hashes it byte-for-byte', async () => {
    process.env.ARBIBOT_SERVICE_AUTH_ENABLED = 'true';
    process.env.ARBIBOT_SERVICE_AUTH_SECRET = SECRET;
    installFetch();

    const bodyBytes = Buffer.from('{"a":1}', 'utf8');
    await signedFetch('http://x/y', { method: 'POST', body: new Uint8Array(bodyBytes) });
    captureCall();

    const headers = new Headers(lastInit?.headers);
    expect(headers.get('x-arbibot-body-sha256')).toBe(sha256Hex(new Uint8Array(bodyBytes)));
  });

  it('includes the query string in pathWithQuery used for signing', async () => {
    process.env.ARBIBOT_SERVICE_AUTH_ENABLED = 'true';
    process.env.ARBIBOT_SERVICE_AUTH_SECRET = SECRET;
    installFetch();

    await signedFetch('http://config-service:3019/effective?environment=prod&tenantId=t1', {
      method: 'GET',
    });
    captureCall();
    const headers = new Headers(lastInit?.headers);
    const sig = headers.get(ARBIBOT_SERVICE_AUTH_HEADER)!;
    const outcome = verifySignature(sig, {
      secret: SECRET,
      method: 'GET',
      pathWithQuery: '/effective?environment=prod&tenantId=t1',
      bodyHashHex: sha256Hex(new Uint8Array(0)),
    });
    expect(outcome.ok).toBe(true);
  });

  it('throws on unsupported body types (object) to avoid silent mis-hashing', async () => {
    process.env.ARBIBOT_SERVICE_AUTH_ENABLED = 'true';
    process.env.ARBIBOT_SERVICE_AUTH_SECRET = SECRET;
    installFetch();

    await expect(
      signedFetch('http://x/y', {
        method: 'POST',
        body: { not: 'a string' } as unknown as BodyInit,
      }),
    ).rejects.toThrow(/unsupported body type|streaming bodies/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the native Response unchanged', async () => {
    process.env.ARBIBOT_SERVICE_AUTH_ENABLED = 'true';
    process.env.ARBIBOT_SERVICE_AUTH_SECRET = SECRET;
    installFetch(202);

    const res = await signedFetch('http://x/y', { method: 'DELETE' });
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(202);
  });
});
