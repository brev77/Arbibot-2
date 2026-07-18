import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { RiskClientService } from './risk-client.service';

describe('RiskClientService', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.RISK_SERVICE_URL = 'http://risk.local';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.RISK_SERVICE_URL;
    delete process.env.ARBIBOT_SERVICE_AUTH_ENABLED;
    delete process.env.ARBIBOT_SERVICE_AUTH_SECRET;
  });

  function validBody() {
    return {
      correlationId: '550e8400-e29b-41d4-a716-446655440000',
      planReference: '11111111-1111-4111-8111-111111111111',
      notionalUsd: 1000,
      snapshotVersion: 1,
    } as const;
  }

  it('maps 400 to BadRequestException', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'bad input' }), { status: 400 }),
      ),
    ) as typeof fetch;

    const service = new RiskClientService();
    await expect(service.evaluateRisk(validBody())).rejects.toThrow(
      BadRequestException,
    );
  });

  it('maps 404 to NotFoundException', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'missing' }), { status: 404 }),
      ),
    ) as typeof fetch;

    const service = new RiskClientService();
    await expect(service.evaluateRisk(validBody())).rejects.toThrow(
      NotFoundException,
    );
  });

  it('maps 409 to ConflictException', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'idempotency mismatch' }), {
          status: 409,
        }),
      ),
    ) as typeof fetch;

    const service = new RiskClientService();
    await expect(service.evaluateRisk(validBody())).rejects.toThrow(
      ConflictException,
    );
  });

  it('maps network errors to ServiceUnavailableException', async () => {
    global.fetch = jest.fn(() => {
      return Promise.reject(new Error('connect ECONNREFUSED'));
    }) as typeof fetch;

    const service = new RiskClientService();
    await expect(service.evaluateRisk(validBody())).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('maps 5xx responses to ServiceUnavailableException', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'server error' }), { status: 503 }),
      ),
    ) as typeof fetch;

    const service = new RiskClientService();
    await expect(service.evaluateRisk(validBody())).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('maps unmapped non-2xx statuses (e.g. 418) to generic HttpException', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: "I'm a teapot" }), { status: 418 }),
      ),
    ) as typeof fetch;

    const service = new RiskClientService();
    let caught: unknown;
    try {
      await service.evaluateRisk(validBody());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect(caught).not.toBeInstanceOf(BadRequestException);
    expect(caught).not.toBeInstanceOf(NotFoundException);
    expect(caught).not.toBeInstanceOf(ConflictException);
    expect(caught).not.toBeInstanceOf(ServiceUnavailableException);
    expect((caught as HttpException).getStatus()).toBe(418);
  });

  it('throws ServiceUnavailableException when the response body is non-JSON', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(new Response('<html>not json</html>', { status: 200 })),
    ) as typeof fetch;

    const service = new RiskClientService();
    await expect(service.evaluateRisk(validBody())).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('throws ServiceUnavailableException when riskDecisionId is missing', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ someOtherField: 'x' }), { status: 200 }),
      ),
    ) as typeof fetch;

    const service = new RiskClientService();
    await expect(service.evaluateRisk(validBody())).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('returns a parsed EvaluateRiskHttpResponse on happy path', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            riskDecisionId: 'rd-1',
            outboxMessageId: 'om-1',
            outcome: 'approved',
            notionalUsd: 1000,
            entityVersion: 3,
            riskMode: 'fast',
          }),
          { status: 200 },
        ),
      ),
    ) as typeof fetch;

    const service = new RiskClientService();
    const out = await service.evaluateRisk(validBody());
    expect(out).toEqual({
      riskDecisionId: 'rd-1',
      outboxMessageId: 'om-1',
      outcome: 'approved',
      notionalUsd: 1000,
      entityVersion: 3,
      riskMode: 'fast',
    });
  });

  it('applies defaults when optional fields are missing from response', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ riskDecisionId: 'rd-2' }), { status: 200 }),
      ),
    ) as typeof fetch;

    const service = new RiskClientService();
    const out = await service.evaluateRisk({ ...validBody(), notionalUsd: 750 });
    expect(out.outboxMessageId).toBeUndefined();
    expect(out.outcome).toBe('unknown');
    // notional defaults to the request body value when response lacks it.
    expect(out.notionalUsd).toBe(750);
    expect(out.entityVersion).toBe(1);
    expect(out.riskMode).toBe('standard');
  });

  it('forwards traceCorrelationId as x-correlation-id header when provided', async () => {
    let capturedInit: RequestInit | undefined;
    global.fetch = jest.fn((_input, init) => {
      capturedInit = init;
      return Promise.resolve(
        new Response(JSON.stringify({ riskDecisionId: 'rd-3' }), { status: 200 }),
      );
    }) as typeof fetch;

    const service = new RiskClientService();
    await service.evaluateRisk(validBody(), { traceCorrelationId: 'trace-1' });
    const headers = new Headers(capturedInit!.headers);
    expect(headers.get('x-correlation-id')).toBe('trace-1');
  });

  it('omits x-correlation-id header when traceCorrelationId is undefined', async () => {
    let capturedInit: RequestInit | undefined;
    global.fetch = jest.fn((_input, init) => {
      capturedInit = init;
      return Promise.resolve(
        new Response(JSON.stringify({ riskDecisionId: 'rd-4' }), { status: 200 }),
      );
    }) as typeof fetch;

    const service = new RiskClientService();
    await service.evaluateRisk(validBody());
    const headers = new Headers(capturedInit!.headers);
    expect(headers.get('x-correlation-id')).toBeNull();
  });

  it('omits x-correlation-id header when traceCorrelationId is empty string', async () => {
    let capturedInit: RequestInit | undefined;
    global.fetch = jest.fn((_input, init) => {
      capturedInit = init;
      return Promise.resolve(
        new Response(JSON.stringify({ riskDecisionId: 'rd-5' }), { status: 200 }),
      );
    }) as typeof fetch;

    const service = new RiskClientService();
    await service.evaluateRisk(validBody(), { traceCorrelationId: '' });
    const headers = new Headers(capturedInit!.headers);
    expect(headers.get('x-correlation-id')).toBeNull();
  });

  // D4-B-6-MTLS: confirms the client is wired through signedFetch so that, when
  // service auth is enabled, outbound calls carry the HMAC signature header.
  it('attaches x-arbibot-signature when ARBIBOT_SERVICE_AUTH_ENABLED=true', async () => {
    process.env.ARBIBOT_SERVICE_AUTH_ENABLED = 'true';
    process.env.ARBIBOT_SERVICE_AUTH_SECRET = 'a'.repeat(64);

    let capturedInit: RequestInit | undefined;
    global.fetch = jest.fn((_input, init) => {
      capturedInit = init;
      return Promise.resolve(
        new Response(JSON.stringify({ riskDecisionId: 'rd-1' }), { status: 200 }),
      );
    }) as typeof fetch;

    const service = new RiskClientService();
    await service.evaluateRisk(validBody());

    expect(capturedInit).toBeDefined();
    const headers = new Headers(capturedInit!.headers);
    expect(headers.has('x-arbibot-signature')).toBe(true);
    expect(headers.get('x-arbibot-signature')).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  describe('correlationIdForOpportunity', () => {
    it('returns the stored value when it matches the UUID v4 format', () => {
      const svc = new RiskClientService();
      const stored = '550e8400-e29b-41d4-a716-446655440000';
      expect(svc.correlationIdForOpportunity(stored)).toBe(stored);
    });

    it('generates a fresh UUID when stored is null', () => {
      const svc = new RiskClientService();
      const out = svc.correlationIdForOpportunity(null);
      expect(out).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it('generates a fresh UUID when stored is malformed', () => {
      const svc = new RiskClientService();
      const out = svc.correlationIdForOpportunity('not-a-uuid');
      expect(out).toMatch(/^[0-9a-f-]{36}$/i);
      expect(out).not.toBe('not-a-uuid');
    });
  });
});
