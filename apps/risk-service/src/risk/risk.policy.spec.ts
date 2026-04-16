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

  it('applies profile cap below mode threshold', () => {
    const r = evaluateRiskPolicy({
      notionalUsd: 50_000,
      riskMode: 'standard',
      now: new Date('2026-01-15T12:00:00.000Z'),
      profileMaxNotionalUsd: 10_000,
    });
    expect(r.outcome).toBe('rejected');
    expect(r.reasons[0]).toContain('effective cap 10000');
  });

  it('approves when profile cap is above notional and above mode is not binding', () => {
    const r = evaluateRiskPolicy({
      notionalUsd: 500,
      riskMode: 'standard',
      now: new Date('2026-01-15T12:00:00.000Z'),
      profileMaxNotionalUsd: 5_000_000,
    });
    expect(r.outcome).toBe('approved');
  });
});
