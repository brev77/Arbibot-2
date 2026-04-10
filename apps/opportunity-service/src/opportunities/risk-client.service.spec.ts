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
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ message: 'bad input' }), { status: 400 }),
    ) as typeof fetch;

    const service = new RiskClientService();
    await expect(service.evaluateRisk(validBody())).rejects.toThrow(
      BadRequestException,
    );
  });

  it('maps 404 to NotFoundException', async () => {
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ message: 'missing' }), { status: 404 }),
    ) as typeof fetch;

    const service = new RiskClientService();
    await expect(service.evaluateRisk(validBody())).rejects.toThrow(
      NotFoundException,
    );
  });

  it('maps 409 to ConflictException', async () => {
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ message: 'idempotency mismatch' }), {
        status: 409,
      }),
    ) as typeof fetch;

    const service = new RiskClientService();
    await expect(service.evaluateRisk(validBody())).rejects.toThrow(
      ConflictException,
    );
  });

  it('maps network errors to ServiceUnavailableException', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    }) as typeof fetch;

    const service = new RiskClientService();
    await expect(service.evaluateRisk(validBody())).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
