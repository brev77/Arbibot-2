import { evaluateRiskPolicy } from './risk.policy';

describe('evaluateRiskPolicy', () => {
  it('approves within standard limit', () => {
    const r = evaluateRiskPolicy({
      notionalUsd: 100,
      riskMode: 'standard',
      now: new Date('2026-01-15T12:00:00.000Z'),
    });
    expect(r.outcome).toBe('approved');
  });

  it('defers conservative mode outside UTC window', () => {
    const r = evaluateRiskPolicy({
      notionalUsd: 100,
      riskMode: 'conservative',
      now: new Date('2026-01-15T22:00:00.000Z'),
    });
    expect(r.outcome).toBe('deferred');
  });

  it('rejects above conservative limit inside window', () => {
    const r = evaluateRiskPolicy({
      notionalUsd: 300_000,
      riskMode: 'conservative',
      now: new Date('2026-01-15T12:00:00.000Z'),
    });
    expect(r.outcome).toBe('rejected');
  });
});
