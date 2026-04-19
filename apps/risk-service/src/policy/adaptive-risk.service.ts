import { Injectable } from '@nestjs/common';

import type { RiskMode } from '../risk/domain/risk-decision';

/**
 * Lightweight adaptive cap multiplier (P2-2.2-ADRISK / PRIO-P1-ADRISK).
 * Tightens profile caps during UTC peak hours; deterministic for idempotent EvaluateRisk.
 */
@Injectable()
export class AdaptiveRiskService {
  /** UTC hours [start, end] inclusive — treat as elevated activity / tighter caps. */
  private static readonly PEAK_START = 12;
  private static readonly PEAK_END = 20;

  /**
   * Returns a multiplier in (0, 1] applied to DB profile max notional when adaptive mode is on.
   */
  multiplierFor(now: Date, riskMode: RiskMode): number {
    const h = now.getUTCHours();
    const inPeak =
      h >= AdaptiveRiskService.PEAK_START && h <= AdaptiveRiskService.PEAK_END;
    if (riskMode === 'conservative') {
      return inPeak ? 0.75 : 0.9;
    }
    if (riskMode === 'fast') {
      return inPeak ? 0.85 : 1.0;
    }
    // standard
    return inPeak ? 0.9 : 1.0;
  }

  describeMultiplier(now: Date, riskMode: RiskMode): string {
    const m = this.multiplierFor(now, riskMode);
    const h = now.getUTCHours();
    const peak =
      h >= AdaptiveRiskService.PEAK_START && h <= AdaptiveRiskService.PEAK_END;
    return `Adaptive risk: UTC hour ${h}, peak=${peak}, multiplier=${m} (${riskMode})`;
  }
}
