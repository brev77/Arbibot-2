import {
  BadRequestException,
  ConflictException,
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
});
