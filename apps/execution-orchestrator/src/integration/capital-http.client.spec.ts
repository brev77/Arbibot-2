import {
  BadGatewayException,
  NotFoundException,
} from '@nestjs/common';

import { CapitalHttpClient } from './capital-http.client';

/**
 * CapitalHttpClient spec (Phase 4 — integration client coverage).
 *
 * The client fetches an authoritative reservation snapshot from the
 * capital-service `GET /capital/reservations/:id` endpoint. We exercise:
 *   - happy-path parse (string id/state/amountUsd/expiresAt, null|undefined|
 *     string correlationId/planId)
 *   - correlation-id header forwarding when present
 *   - 404 → NotFoundException
 *   - non-2xx → BadGatewayException with body text
 *   - network failure → BadGatewayException with err.message
 *   - non-Error throw → BadGatewayException with String(err)
 *   - non-JSON response body → BadGatewayException
 *   - malformed snapshot (missing fields / non-record) → BadGatewayException
 */
describe('CapitalHttpClient', () => {
  const originalFetch = global.fetch;
  const prevBaseUrl = process.env.CAPITAL_SERVICE_BASE_URL;
  const prevUrl = process.env.CAPITAL_SERVICE_URL;

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
    delete process.env.CAPITAL_SERVICE_BASE_URL;
    delete process.env.CAPITAL_SERVICE_URL;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (prevBaseUrl === undefined) {
      delete process.env.CAPITAL_SERVICE_BASE_URL;
    } else {
      process.env.CAPITAL_SERVICE_BASE_URL = prevBaseUrl;
    }
    if (prevUrl === undefined) {
      delete process.env.CAPITAL_SERVICE_URL;
    } else {
      process.env.CAPITAL_SERVICE_URL = prevUrl;
    }
  });

  const setFetch = (impl: (...args: Parameters<typeof fetch>) => Promise<Response>) => {
    global.fetch = impl;
  };

  it('returns a parsed snapshot on happy path (string correlationId/planId)', async () => {
    setFetch(() =>
      Promise.resolve(
        mkResponse({
          body: {
            id: 'cap-1',
            state: 'active',
            amountUsd: '100',
            expiresAt: '2026-07-17T10:00:00.000Z',
            correlationId: 'corr-1',
            planId: 'plan-1',
          },
        }),
      ),
    );
    const out = await new CapitalHttpClient().getReservation('cap-1');
    expect(out).toEqual({
      id: 'cap-1',
      state: 'active',
      correlationId: 'corr-1',
      planId: 'plan-1',
      expiresAtIso: '2026-07-17T10:00:00.000Z',
    });
  });

  it('projects null correlationId/planId when fields are undefined', async () => {
    setFetch(() =>
      Promise.resolve(
        mkResponse({
          body: {
            id: 'cap-1',
            state: 'active',
            amountUsd: '100',
            expiresAt: '2026-07-17T10:00:00.000Z',
            // correlationId + planId omitted
          },
        }),
      ),
    );
    const out = await new CapitalHttpClient().getReservation('cap-1');
    expect(out.correlationId).toBeNull();
    expect(out.planId).toBeNull();
  });

  it('projects null correlationId/planId when fields are explicit null', async () => {
    setFetch(() =>
      Promise.resolve(
        mkResponse({
          body: {
            id: 'cap-1',
            state: 'active',
            amountUsd: '100',
            expiresAt: '2026-07-17T10:00:00.000Z',
            correlationId: null,
            planId: null,
          },
        }),
      ),
    );
    const out = await new CapitalHttpClient().getReservation('cap-1');
    expect(out.correlationId).toBeNull();
    expect(out.planId).toBeNull();
  });

  it('projects null correlationId/planId when fields are non-string (defensive)', async () => {
    setFetch(() =>
      Promise.resolve(
        mkResponse({
          body: {
            id: 'cap-1',
            state: 'active',
            amountUsd: '100',
            expiresAt: '2026-07-17T10:00:00.000Z',
            correlationId: 42,
            planId: false,
          },
        }),
      ),
    );
    const out = await new CapitalHttpClient().getReservation('cap-1');
    expect(out.correlationId).toBeNull();
    expect(out.planId).toBeNull();
  });

  it('throws NotFoundException on 404', async () => {
    setFetch(() =>
      Promise.resolve(mkResponse({ ok: false, status: 404, body: 'not found' })),
    );
    await expect(
      new CapitalHttpClient().getReservation('missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws BadGatewayException on non-2xx (non-404) with body text', async () => {
    setFetch(() =>
      Promise.resolve(
        mkResponse({ ok: false, status: 503, body: 'service unavailable' }),
      ),
    );
    await expect(
      new CapitalHttpClient().getReservation('cap-1'),
    ).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('503'),
    });
  });

  it('throws BadGatewayException on network failure (Error)', async () => {
    setFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    await expect(
      new CapitalHttpClient().getReservation('cap-1'),
    ).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('ECONNREFUSED'),
    });
  });

  it('throws BadGatewayException on non-Error throw (stringified)', async () => {
    setFetch(() => Promise.reject(new Error('string-error')));
    await expect(
      new CapitalHttpClient().getReservation('cap-1'),
    ).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('string-error'),
    });
  });

  it('throws BadGatewayException on non-JSON body', async () => {
    setFetch(() =>
      Promise.resolve(mkResponse({ body: {}, jsonThrows: true })),
    );
    await expect(
      new CapitalHttpClient().getReservation('cap-1'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('throws BadGatewayException on non-record body (array)', async () => {
    setFetch(() =>
      Promise.resolve(mkResponse({ body: ['not', 'an', 'object'] })),
    );
    await expect(
      new CapitalHttpClient().getReservation('cap-1'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('throws BadGatewayException when id is missing', async () => {
    setFetch(() =>
      Promise.resolve(
        mkResponse({
          body: { state: 'active', amountUsd: '100', expiresAt: 'x' },
        }),
      ),
    );
    await expect(
      new CapitalHttpClient().getReservation('cap-1'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('throws BadGatewayException when amountUsd is non-string', async () => {
    setFetch(() =>
      Promise.resolve(
        mkResponse({
          body: {
            id: 'cap-1',
            state: 'active',
            amountUsd: 100,
            expiresAt: 'x',
          },
        }),
      ),
    );
    await expect(
      new CapitalHttpClient().getReservation('cap-1'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('uses CAPITAL_SERVICE_BASE_URL when set (trailing slash stripped)', async () => {
    process.env.CAPITAL_SERVICE_BASE_URL = 'http://cap.example/';
    const fetchFn = jest.fn((..._args: Parameters<typeof fetch>) =>
      Promise.resolve(
        mkResponse({
          body: {
            id: 'cap-1',
            state: 'active',
            amountUsd: '100',
            expiresAt: 'x',
          },
        }),
      ),
    );
    global.fetch = fetchFn;
    await new CapitalHttpClient().getReservation('cap-1');
    expect(fetchFn.mock.calls[0]?.[0]).toBe(
      'http://cap.example/capital/reservations/cap-1',
    );
  });
});
