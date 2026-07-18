import {
  BadGatewayException,
  NotFoundException,
} from '@nestjs/common';

import { RiskHttpClient } from './risk-http.client';

/**
 * RiskHttpClient spec (Phase 4 — integration client coverage).
 *
 * The client fetches an authoritative risk decision snapshot from the
 * risk-service `GET /risk-decisions/:id` endpoint. We exercise the same
 * branch matrix as CapitalHttpClient (happy path, 404, non-2xx, network
 * failure, non-Error throw, non-JSON body, malformed snapshot).
 */
describe('RiskHttpClient', () => {
  const originalFetch = global.fetch;
  const prevBaseUrl = process.env.RISK_SERVICE_BASE_URL;
  const prevUrl = process.env.RISK_SERVICE_URL;

  const mkResponse = (opts: {
    ok?: boolean;
    status?: number;
    body?: unknown;
    jsonThrows?: boolean;
  }): Response => {
    const ok = opts.ok ?? true;
    const status = opts.status ?? 200;
    const text = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body ?? {});
    return {
      ok,
      status,
      text: () =>
        opts.jsonThrows
          ? Promise.reject(new Error('not json'))
          : Promise.resolve(text),
      json: () =>
        opts.jsonThrows
          ? Promise.reject(new Error('not json'))
          : Promise.resolve(opts.body),
    } as Response;
  };

  beforeEach(() => {
    delete process.env.RISK_SERVICE_BASE_URL;
    delete process.env.RISK_SERVICE_URL;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (prevBaseUrl === undefined) {
      delete process.env.RISK_SERVICE_BASE_URL;
    } else {
      process.env.RISK_SERVICE_BASE_URL = prevBaseUrl;
    }
    if (prevUrl === undefined) {
      delete process.env.RISK_SERVICE_URL;
    } else {
      process.env.RISK_SERVICE_URL = prevUrl;
    }
  });

  const setFetch = (impl: (...args: Parameters<typeof fetch>) => Promise<Response>) => {
    global.fetch = impl;
  };

  it('returns a parsed snapshot on happy path', async () => {
    setFetch(() =>
      Promise.resolve(
        mkResponse({
          body: {
            id: 'rd-1',
            correlationId: 'corr-1',
            outcome: 'approved',
          },
        }),
      ),
    );
    const out = await new RiskHttpClient().getRiskDecision('rd-1');
    expect(out).toEqual({
      id: 'rd-1',
      correlationId: 'corr-1',
      outcome: 'approved',
    });
  });

  it('throws NotFoundException on 404', async () => {
    setFetch(() =>
      Promise.resolve(mkResponse({ ok: false, status: 404, body: 'not found' })),
    );
    await expect(
      new RiskHttpClient().getRiskDecision('missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws BadGatewayException on non-2xx (non-404) with body text', async () => {
    setFetch(() =>
      Promise.resolve(
        mkResponse({ ok: false, status: 500, body: 'server error' }),
      ),
    );
    await expect(
      new RiskHttpClient().getRiskDecision('rd-1'),
    ).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('500'),
    });
  });

  it('throws BadGatewayException on network failure (Error)', async () => {
    setFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    await expect(
      new RiskHttpClient().getRiskDecision('rd-1'),
    ).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('ECONNREFUSED'),
    });
  });

  it('throws BadGatewayException on non-Error throw (stringified)', async () => {
    setFetch(() => Promise.reject(new Error('boom')));
    await expect(
      new RiskHttpClient().getRiskDecision('rd-1'),
    ).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('boom'),
    });
  });

  it('throws BadGatewayException on non-JSON body', async () => {
    setFetch(() =>
      Promise.resolve(mkResponse({ body: {}, jsonThrows: true })),
    );
    await expect(
      new RiskHttpClient().getRiskDecision('rd-1'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('throws BadGatewayException on non-record body (array)', async () => {
    setFetch(() =>
      Promise.resolve(mkResponse({ body: [] })),
    );
    await expect(
      new RiskHttpClient().getRiskDecision('rd-1'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('throws BadGatewayException when id is missing', async () => {
    setFetch(() =>
      Promise.resolve(
        mkResponse({
          body: { correlationId: 'c', outcome: 'approved' },
        }),
      ),
    );
    await expect(
      new RiskHttpClient().getRiskDecision('rd-1'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('throws BadGatewayException when outcome is non-string', async () => {
    setFetch(() =>
      Promise.resolve(
        mkResponse({
          body: { id: 'rd-1', correlationId: 'c', outcome: 42 },
        }),
      ),
    );
    await expect(
      new RiskHttpClient().getRiskDecision('rd-1'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('uses RISK_SERVICE_BASE_URL when set (trailing slash stripped)', async () => {
    process.env.RISK_SERVICE_BASE_URL = 'http://risk.example/';
    const fetchFn = jest.fn((..._args: Parameters<typeof fetch>) =>
      Promise.resolve(
        mkResponse({
          body: {
            id: 'rd-1',
            correlationId: 'c',
            outcome: 'approved',
          },
        }),
      ),
    );
    global.fetch = fetchFn;
    await new RiskHttpClient().getRiskDecision('rd-1');
    expect(fetchFn.mock.calls[0]?.[0]).toBe(
      'http://risk.example/risk-decisions/rd-1',
    );
  });
});
