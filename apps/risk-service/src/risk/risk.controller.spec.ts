import { NotFoundException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';

import { RiskController } from './risk.controller';
import { RiskService } from './risk.service';

describe('RiskController (HTTP)', () => {
  let app: NestFastifyApplication;
  const evaluateRisk = jest.fn();
  const getRiskDecision = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [RiskController],
      providers: [
        {
          provide: RiskService,
          useValue: { evaluateRisk, getRiskDecision },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(() => {
    evaluateRisk.mockReset();
    getRiskDecision.mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /evaluate-risk returns 201 and body', async () => {
    evaluateRisk.mockResolvedValue({
      replay: false,
      response: {
        riskDecisionId: 'a1111111-1111-4111-8111-111111111111',
        outcome: 'approved',
        entityVersion: 1,
        riskMode: 'standard',
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/evaluate-risk',
      headers: { 'content-type': 'application/json' },
      payload: {
        correlationId: '550e8400-e29b-41d4-a716-446655440000',
        planReference: 'plan-phase0',
        notionalUsd: 5000,
        snapshotVersion: 1,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as {
      riskDecisionId: string;
      outcome: string;
      entityVersion: number;
      riskMode: string;
    };
    expect(body.riskDecisionId).toBe('a1111111-1111-4111-8111-111111111111');
    expect(body.outcome).toBe('approved');
    expect(body.entityVersion).toBe(1);
    expect(body.riskMode).toBe('standard');
  });

  it('POST /evaluate-risk returns 200 on idempotent replay', async () => {
    evaluateRisk.mockResolvedValue({
      replay: true,
      response: {
        riskDecisionId: 'a1111111-1111-4111-8111-111111111111',
        outcome: 'approved',
        entityVersion: 1,
        riskMode: 'standard',
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/evaluate-risk',
      headers: { 'content-type': 'application/json' },
      payload: {
        idempotencyKey: '9ba7b810-9dad-41d1-80b4-00c04fd430c8',
        correlationId: '550e8400-e29b-41d4-a716-446655440000',
        planReference: 'plan-phase0',
        notionalUsd: 5000,
        snapshotVersion: 1,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-idempotent-replayed']).toBe('true');
  });

  it('GET /risk-decisions/:id returns 200', async () => {
    getRiskDecision.mockResolvedValue({
      id: 'b2222222-2222-4222-8222-222222222222',
      correlationId: '6ba7b810-9dad-11d1-a0b4-00c04fd430c8',
      planReference: 'plan-b',
      outcome: 'approved',
      reasons: ['ok'],
      snapshotVersion: 2,
      riskMode: 'standard',
      createdAtIso: new Date().toISOString(),
      entityVersion: 1,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/risk-decisions/b2222222-2222-4222-8222-222222222222',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { id: string; planReference: string };
    expect(body.id).toBe('b2222222-2222-4222-8222-222222222222');
    expect(body.planReference).toBe('plan-b');
  });

  it('GET /risk-decisions/:id returns 404 when missing', async () => {
    getRiskDecision.mockRejectedValue(new NotFoundException());
    const res = await app.inject({
      method: 'GET',
      url: '/risk-decisions/a1111111-1111-4111-8111-111111111111',
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /evaluate-risk returns 400 on invalid body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/evaluate-risk',
      headers: { 'content-type': 'application/json' },
      payload: {
        correlationId: 'not-a-uuid',
        planReference: '',
        notionalUsd: -1,
        snapshotVersion: 0,
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
