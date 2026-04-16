import type { ExecutionLegEntity, ExecutionPlanEntity } from '@arbibot/persistence';
import { runWithCorrelationId } from '@arbibot/nest-platform';

import { buildLegSubmitIdempotencyKey, HttpVenueAdapter } from './http-venue.adapter';
import {
  VenueSubmitClientError,
  VenueSubmitTransientError,
  VenueTerminalSubmitError,
} from './venue-adapter';

function planStub(id: string, correlationId?: string | null): ExecutionPlanEntity {
  return { id, correlationId: correlationId ?? null } as ExecutionPlanEntity;
}

function legStub(id: string, legIndex: number): ExecutionLegEntity {
  return { id, legIndex } as ExecutionLegEntity;
}

describe('HttpVenueAdapter', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.VENUE_HTTP_TIMEOUT_MS;
  });

  it('returns externalOrderId on 200', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ externalOrderId: 'ord-1' })),
    });

    const adapter = new HttpVenueAdapter('http://venue.example');
    const leg = legStub('l1', 0);
    const out = await adapter.submitLeg(planStub('p1'), leg);
    expect(out.externalOrderId).toBe('ord-1');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://venue.example/v1/submit-leg',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          planId: 'p1',
          legId: 'l1',
          legIndex: 0,
          submitIdempotencyKey: buildLegSubmitIdempotencyKey('l1'),
        }),
      }),
    );
  });

  it('strips trailing slash on base URL', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ externalOrderId: 'x' })),
    });

    const adapter = new HttpVenueAdapter('http://venue.example/');
    await adapter.submitLeg(planStub('p'), legStub('l', 1));
    expect(global.fetch).toHaveBeenCalledWith(
      'http://venue.example/v1/submit-leg',
      expect.any(Object),
    );
  });

  it('maps 503 to transient', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve('unavailable'),
    });

    const adapter = new HttpVenueAdapter('http://venue.example');
    await expect(adapter.submitLeg(planStub('p'), legStub('l', 0))).rejects.toBeInstanceOf(
      VenueSubmitTransientError,
    );
  });

  it('maps 408 to transient', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 408,
      text: () => Promise.resolve('timeout'),
    });

    const adapter = new HttpVenueAdapter('http://venue.example');
    await expect(adapter.submitLeg(planStub('p'), legStub('l', 0))).rejects.toBeInstanceOf(
      VenueSubmitTransientError,
    );
  });

  it('maps 400 to client error (not transient)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('bad'),
    });

    const adapter = new HttpVenueAdapter('http://venue.example');
    await expect(adapter.submitLeg(planStub('p'), legStub('l', 0))).rejects.toBeInstanceOf(
      VenueSubmitClientError,
    );
  });

  it('maps 401 to client error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('nope'),
    });

    const adapter = new HttpVenueAdapter('http://venue.example');
    await expect(adapter.submitLeg(planStub('p'), legStub('l', 0))).rejects.toBeInstanceOf(
      VenueSubmitClientError,
    );
  });

  it('maps fetch rejection to transient', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed'));

    const adapter = new HttpVenueAdapter('http://venue.example');
    await expect(adapter.submitLeg(planStub('p'), legStub('l', 0))).rejects.toBeInstanceOf(
      VenueSubmitTransientError,
    );
  });

  it('maps abort timeout to transient', async () => {
    process.env.VENUE_HTTP_TIMEOUT_MS = '30';
    global.fetch = jest.fn(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal ?? null;
          if (signal === null) {
            reject(new Error('expected AbortSignal'));
            return;
          }
          if (signal.aborted) {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
            return;
          }
          signal.addEventListener('abort', () => {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );

    const adapter = new HttpVenueAdapter('http://venue.example');
    await expect(adapter.submitLeg(planStub('p'), legStub('l', 0))).rejects.toMatchObject({
      name: 'VenueSubmitTransientError',
    });
  }, 10_000);

  it('sends x-correlation-id from ALS when set', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ externalOrderId: 'ord-1' })),
    });

    const adapter = new HttpVenueAdapter('http://venue.example');
    await runWithCorrelationId('corr-from-als', () =>
      adapter.submitLeg(planStub('p1', 'corr-from-plan'), legStub('l1', 0)),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-correlation-id': 'corr-from-als',
        }),
      }),
    );
  });

  it('sends x-correlation-id from plan when ALS empty', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ externalOrderId: 'ord-1' })),
    });

    const adapter = new HttpVenueAdapter('http://venue.example');
    await adapter.submitLeg(planStub('p1', 'only-plan'), legStub('l1', 0));
    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-correlation-id': 'only-plan',
        }),
      }),
    );
  });

  it('maps 200 with invalid JSON to client error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{not-json'),
    });

    const adapter = new HttpVenueAdapter('http://venue.example');
    await expect(adapter.submitLeg(planStub('p'), legStub('l', 0))).rejects.toBeInstanceOf(
      VenueSubmitClientError,
    );
  });

  it('maps 200 with missing externalOrderId to client error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({})),
    });

    const adapter = new HttpVenueAdapter('http://venue.example');
    await expect(adapter.submitLeg(planStub('p'), legStub('l', 0))).rejects.toBeInstanceOf(
      VenueSubmitClientError,
    );
  });

  it('maps 409 with terminalState to terminal error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      text: () => Promise.resolve(JSON.stringify({ terminalState: 'rejected' })),
    });

    const adapter = new HttpVenueAdapter('http://venue.example');
    try {
      await adapter.submitLeg(planStub('p'), legStub('l', 0));
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(VenueTerminalSubmitError);
      expect((e as VenueTerminalSubmitError).terminalState).toBe('rejected');
    }
  });

  it('maps 409 without terminalState to client error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      text: () => Promise.resolve(JSON.stringify({})),
    });

    const adapter = new HttpVenueAdapter('http://venue.example');
    await expect(adapter.submitLeg(planStub('p'), legStub('l', 0))).rejects.toBeInstanceOf(
      VenueSubmitClientError,
    );
  });
});
