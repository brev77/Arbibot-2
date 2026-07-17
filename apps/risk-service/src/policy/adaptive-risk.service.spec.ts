import { AdaptiveRiskService } from './adaptive-risk.service';

/**
 * AdaptiveRiskService spec (P2-2.2-ADRISK).
 *
 * Pure function of (UTC hour, riskMode) -> multiplier. The PEAK window is
 * [12, 20] UTC inclusive. Determinism matters: EvaluateRisk must be idempotent
 * for the same inputs.
 */
describe('AdaptiveRiskService', () => {
  let service: AdaptiveRiskService;

  beforeEach(() => {
    service = new AdaptiveRiskService();
  });

  describe('multiplierFor', () => {
    it('conservative mode: 0.75 inside peak, 0.9 outside peak', () => {
      const peak = new Date('2026-07-17T15:00:00Z'); // 15:00 UTC
      const offPeak = new Date('2026-07-17T05:00:00Z'); // 05:00 UTC

      expect(service.multiplierFor(peak, 'conservative')).toBe(0.75);
      expect(service.multiplierFor(offPeak, 'conservative')).toBe(0.9);
    });

    it('fast mode: 0.85 inside peak, 1.0 outside peak', () => {
      const peak = new Date('2026-07-17T12:00:00Z'); // boundary start inclusive
      const offPeak = new Date('2026-07-17T21:00:00Z'); // just after end

      expect(service.multiplierFor(peak, 'fast')).toBe(0.85);
      expect(service.multiplierFor(offPeak, 'fast')).toBe(1.0);
    });

    it('standard mode: 0.9 inside peak, 1.0 outside peak', () => {
      const peak = new Date('2026-07-17T20:00:00Z'); // boundary end inclusive
      const offPeak = new Date('2026-07-17T11:00:00Z'); // just before start

      expect(service.multiplierFor(peak, 'standard')).toBe(0.9);
      expect(service.multiplierFor(offPeak, 'standard')).toBe(1.0);
    });

    it('treats the peak window as inclusive on both ends (12 and 20 are peak)', () => {
      const start = new Date('2026-07-17T12:00:00Z');
      const end = new Date('2026-07-17T20:00:00Z');

      expect(service.multiplierFor(start, 'conservative')).toBe(0.75);
      expect(service.multiplierFor(end, 'conservative')).toBe(0.75);
    });

    it('treats 11:xx and 21:xx UTC as off-peak (outside the window)', () => {
      // getUTCHours() truncates minutes, so any time in hour 11 or 21 is off-peak.
      const before = new Date('2026-07-17T11:59:59Z'); // hour 11
      const after = new Date('2026-07-17T21:00:00Z'); // hour 21

      expect(service.multiplierFor(before, 'conservative')).toBe(0.9);
      expect(service.multiplierFor(after, 'conservative')).toBe(0.9);
    });
  });

  describe('describeMultiplier', () => {
    it('returns a human-readable string with hour, peak flag, multiplier, mode', () => {
      const peak = new Date('2026-07-17T15:00:00Z'); // hour 15, peak

      const desc = service.describeMultiplier(peak, 'fast');

      expect(desc).toBe(
        'Adaptive risk: UTC hour 15, peak=true, multiplier=0.85 (fast)',
      );
    });

    it('reflects off-peak state in the description', () => {
      const offPeak = new Date('2026-07-17T03:00:00Z');

      const desc = service.describeMultiplier(offPeak, 'standard');

      expect(desc).toBe(
        'Adaptive risk: UTC hour 3, peak=false, multiplier=1 (standard)',
      );
    });
  });
});
