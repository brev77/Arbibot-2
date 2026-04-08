import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';

import { RiskModule } from './risk.module';

describe('RiskController (HTTP)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RiskModule],
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

  afterAll(async () => {
    await app.close();
  });

  it('POST /evaluate-risk returns 201 and body', async () => {
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
    };
    expect(body.riskDecisionId).toBeDefined();
    expect(body.outcome).toBe('approved');
    expect(body.entityVersion).toBe(1);
  });

  it('GET /risk-decisions/:id returns 200 after evaluate', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/evaluate-risk',
      headers: { 'content-type': 'application/json' },
      payload: {
        correlationId: '6ba7b810-9dad-41d1-a0b4-00c04fd430c8',
        planReference: 'plan-b',
        notionalUsd: 100,
        snapshotVersion: 2,
      },
    });
    const { riskDecisionId } = JSON.parse(created.body) as {
      riskDecisionId: string;
    };

    const res = await app.inject({
      method: 'GET',
      url: `/risk-decisions/${riskDecisionId}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { id: string; planReference: string };
    expect(body.id).toBe(riskDecisionId);
    expect(body.planReference).toBe('plan-b');
  });

  it('GET /risk-decisions/:id returns 404 when missing', async () => {
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
