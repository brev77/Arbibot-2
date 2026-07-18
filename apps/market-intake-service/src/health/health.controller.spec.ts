import { HealthController } from './health.controller';
import { DegradationStateService } from '../policy/degradation-state.service';

/**
 * HealthController spec (Phase 4 — market-intake-service health.controller coverage).
 *
 * The controller exposes one operator-facing probe — `GET /health/degradation` —
 * which projects the DegradationStateService snapshot into the API payload
 * documented in `docs/phase4-ui-degraded-signals.md`. The rate normalization
 * (throttledCount5m / 300s) and the `tier` projection (baseline when in
 * fallbackMode, hot otherwise) are the only real logic to assert; the rest
 * is field forwarding.
 */
describe('HealthController', () => {
  const mkSnapshot = (
    overrides: Partial<
      ReturnType<DegradationStateService['getSnapshot']>
    > = {},
  ) => ({
    fallbackMode: false,
    policyCacheTtlMs: 120_000,
    lastPolicyRefreshAtIso: '2026-07-17T00:00:00.000Z',
    intakeThrottlingEnabled: true,
    throttledCount5m: 0,
    ...overrides,
  });

  const mkService = (
    snapshot: ReturnType<typeof mkSnapshot>,
  ): { svc: HealthController; snapshot: typeof snapshot } => {
    const degradationState = {
      getSnapshot: jest.fn(() => snapshot),
    };
    return {
      svc: new HealthController(
        degradationState as unknown as DegradationStateService,
      ),
      snapshot,
    };
  };

  it('reports tier=hot when not in fallbackMode', () => {
    const { svc } = mkService(mkSnapshot({ fallbackMode: false }));
    expect(svc.degradationStatus().tier).toBe('hot');
  });

  it('reports tier=baseline when in fallbackMode', () => {
    const { svc } = mkService(mkSnapshot({ fallbackMode: true }));
    expect(svc.degradationStatus().tier).toBe('baseline');
  });

  it('reports throttledRate=0 when no throttles in window', () => {
    const { svc } = mkService(mkSnapshot({ throttledCount5m: 0 }));
    expect(svc.degradationStatus().throttledRate).toBe(0);
  });

  it('normalizes throttledCount5m=300 to throttledRate=1.0 (one per second)', () => {
    const { svc } = mkService(mkSnapshot({ throttledCount5m: 300 }));
    expect(svc.degradationStatus().throttledRate).toBeCloseTo(1.0, 6);
  });

  it('normalizes throttledCount5m=150 to throttledRate=0.5', () => {
    const { svc } = mkService(mkSnapshot({ throttledCount5m: 150 }));
    expect(svc.degradationStatus().throttledRate).toBeCloseTo(0.5, 6);
  });

  it('forwards policyCacheTtlMs / lastPolicyRefreshAtIso / intakeThrottlingEnabled', () => {
    const { svc } = mkService(
      mkSnapshot({
        policyCacheTtlMs: 90_000,
        lastPolicyRefreshAtIso: '2026-07-18T10:00:00.000Z',
        intakeThrottlingEnabled: false,
      }),
    );
    const out = svc.degradationStatus();
    expect(out.policyCacheTtlMs).toBe(90_000);
    expect(out.lastPolicyRefreshAtIso).toBe('2026-07-18T10:00:00.000Z');
    expect(out.intakeThrottlingEnabled).toBe(false);
  });

  it('forwards null lastPolicyRefreshAtIso when snapshot has no prior refresh', () => {
    const { svc } = mkService(
      mkSnapshot({ lastPolicyRefreshAtIso: null }),
    );
    expect(svc.degradationStatus().lastPolicyRefreshAtIso).toBeNull();
  });

  it('forwards fallbackMode flag verbatim alongside the tier projection', () => {
    const { svc } = mkService(mkSnapshot({ fallbackMode: true }));
    const out = svc.degradationStatus();
    expect(out.fallbackMode).toBe(true);
    expect(out.tier).toBe('baseline');
  });
});
