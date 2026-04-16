import { ConflictException, NotFoundException } from '@nestjs/common';

import type { OutboxEventEntity, RiskDecisionEntity } from '@arbibot/persistence';
import type { DataSource, EntityManager, Repository } from 'typeorm';

import type { IAuditClient } from '@arbibot/nest-platform';

import { EvaluateRiskRequestDto } from './dto/evaluate-risk-request.dto';
import { RiskService } from './risk.service';

describe('RiskService', () => {
  let service: RiskService;
  let decisions: RiskDecisionEntity[];
  let outbox: OutboxEventEntity[];
  const auditRecord = jest.fn();

  beforeEach(() => {
    decisions = [];
    outbox = [];
    const em = {
      findOne: jest.fn(
        (
          _Entity: unknown,
          opts: {
            where: { id?: string; idempotencyKey?: string };
            lock?: unknown;
          },
        ) => {
          if (opts.where.id !== undefined) {
            return decisions.find((d) => d.id === opts.where.id) ?? null;
          }
          if (opts.where.idempotencyKey !== undefined) {
            return (
              decisions.find(
                (d) => d.idempotencyKey === opts.where.idempotencyKey,
              ) ?? null
            );
          }
          return null;
        },
      ),
      create: jest.fn((_Entity: unknown, row: object) => ({ ...row })),
      save: jest.fn(
        (
          targetOrEntity: unknown,
          maybeEntity?: RiskDecisionEntity | OutboxEventEntity,
        ) => {
          const entity = (maybeEntity ?? targetOrEntity) as Record<
            string,
            unknown
          >;
          if ('outcome' in entity && 'planReference' in entity) {
            decisions.push(entity as unknown as RiskDecisionEntity);
            return entity;
          }
          outbox.push(entity as unknown as OutboxEventEntity);
          return entity;
        },
      ),
    } as unknown as EntityManager;

    const dataSource = {
      transaction: jest.fn(async (fn: (m: EntityManager) => Promise<unknown>) => {
        return fn(em);
      }),
    } as unknown as DataSource;

    const decisionRepo = {
      findOne: jest.fn(({ where }: { where: { id: string } }) => {
        return decisions.find((d) => d.id === where.id) ?? null;
      }),
    } as unknown as Repository<RiskDecisionEntity>;

    const audit = {
      record: auditRecord,
      appendEntry: jest.fn(),
    } as unknown as IAuditClient;
    service = new RiskService(dataSource, decisionRepo, audit);
  });

  const validRequest = (): EvaluateRiskRequestDto => {
    const dto = new EvaluateRiskRequestDto();
    dto.correlationId = '550e8400-e29b-41d4-a716-446655440000';
    dto.planReference = 'plan-phase0';
    dto.notionalUsd = 10_000;
    dto.snapshotVersion = 1;
    return dto;
  };

  it('persists a decision and returns identifiers on evaluateRisk', async () => {
    const res = await service.evaluateRisk(validRequest());
    expect(res.replay).toBe(false);
    expect(res.response.riskDecisionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(res.response.outboxMessageId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(res.response.outcome).toBe('approved');
    expect(res.response.entityVersion).toBe(1);
    expect(res.response.riskMode).toBe('standard');
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.eventType).toBe('RiskDecisionIssued');
  });

  it('getRiskDecision returns stored aggregate', async () => {
    const created = await service.evaluateRisk(validRequest());
    const full = await service.getRiskDecision(created.response.riskDecisionId);
    expect(full.id).toBe(created.response.riskDecisionId);
    expect(full.correlationId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(full.planReference).toBe('plan-phase0');
    expect(full.outcome).toBe('approved');
    expect(full.reasons.length).toBeGreaterThan(0);
    expect(full.snapshotVersion).toBe(1);
    expect(full.entityVersion).toBe(1);
    expect(full.riskMode).toBe('standard');
  });

  it('rejects when notional exceeds standard threshold', async () => {
    const dto = validRequest();
    dto.notionalUsd = 2_000_000;
    const res = await service.evaluateRisk(dto);
    expect(res.replay).toBe(false);
    expect(res.response.outcome).toBe('rejected');
    const full = await service.getRiskDecision(res.response.riskDecisionId);
    expect(full.outcome).toBe('rejected');
  });

  it('getRiskDecision throws when id is unknown', async () => {
    await expect(
      service.getRiskDecision('6ba7b810-9dad-11d1-80b4-00c04fd430c8'),
    ).rejects.toThrow(NotFoundException);
  });

  it('replays evaluate when idempotency key matches same payload', async () => {
    const dto = validRequest();
    dto.idempotencyKey = '7ba7b810-9dad-11d1-80b4-00c04fd430c8';
    const first = await service.evaluateRisk(dto);
    expect(first.replay).toBe(false);
    expect(outbox).toHaveLength(1);
    const second = await service.evaluateRisk(dto);
    expect(second.replay).toBe(true);
    expect(second.response.riskDecisionId).toBe(first.response.riskDecisionId);
    expect(second.response.outboxMessageId).toBeUndefined();
    expect(outbox).toHaveLength(1);
  });

  it('conflicts when idempotency key matches different payload', async () => {
    const dto = validRequest();
    dto.idempotencyKey = '8ba7b810-9dad-11d1-80b4-00c04fd430c8';
    await service.evaluateRisk(dto);
    const replay = validRequest();
    replay.idempotencyKey = dto.idempotencyKey;
    replay.notionalUsd = 2_000_000;
    await expect(service.evaluateRisk(replay)).rejects.toThrow(ConflictException);
  });
});
