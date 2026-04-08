import { NotFoundException } from '@nestjs/common';

import { EvaluateRiskRequestDto } from './dto/evaluate-risk-request.dto';
import { RiskService } from './risk.service';

describe('RiskService', () => {
  let service: RiskService;

  beforeEach(() => {
    service = new RiskService();
  });

  const validRequest = (): EvaluateRiskRequestDto => {
    const dto = new EvaluateRiskRequestDto();
    dto.correlationId = '550e8400-e29b-41d4-a716-446655440000';
    dto.planReference = 'plan-phase0';
    dto.notionalUsd = 10_000;
    dto.snapshotVersion = 1;
    return dto;
  };

  it('persists a decision and returns identifiers on evaluateRisk', () => {
    const res = service.evaluateRisk(validRequest());
    expect(res.riskDecisionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(res.outcome).toBe('approved');
    expect(res.entityVersion).toBe(1);
  });

  it('getRiskDecision returns stored aggregate', () => {
    const created = service.evaluateRisk(validRequest());
    const full = service.getRiskDecision(created.riskDecisionId);
    expect(full.id).toBe(created.riskDecisionId);
    expect(full.correlationId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(full.planReference).toBe('plan-phase0');
    expect(full.outcome).toBe('approved');
    expect(full.reasons.length).toBeGreaterThan(0);
    expect(full.snapshotVersion).toBe(1);
    expect(full.entityVersion).toBe(1);
  });

  it('rejects when notional exceeds Phase 0 threshold', () => {
    const dto = validRequest();
    dto.notionalUsd = 2_000_000;
    const res = service.evaluateRisk(dto);
    expect(res.outcome).toBe('rejected');
    const full = service.getRiskDecision(res.riskDecisionId);
    expect(full.outcome).toBe('rejected');
  });

  it('getRiskDecision throws when id is unknown', () => {
    expect(() =>
      service.getRiskDecision('6ba7b810-9dad-11d1-80b4-00c04fd430c8'),
    ).toThrow(NotFoundException);
  });
});
