import type { RiskDecisionOutcome } from './domain/risk-decision';

export type RiskMode = 'fast' | 'standard' | 'conservative';

const THRESHOLDS_USD: Record<RiskMode, number> = {
  fast: 5_000_000,
  standard: 1_000_000,
  conservative: 250_000,
};

const CONSERVATIVE_UTC_START = 8;
const CONSERVATIVE_UTC_END = 20;

export interface PolicyInput {
  readonly notionalUsd: number;
  readonly riskMode: RiskMode;
  readonly now: Date;
}

export interface PolicyResult {
  readonly outcome: RiskDecisionOutcome;
  readonly reasons: readonly string[];
}

/**
 * Phase 1 policy: notional limits per risk mode + conservative trading window (UTC).
 */
export function evaluateRiskPolicy(input: PolicyInput): PolicyResult {
  const hourUtc = input.now.getUTCHours();
  const outsideConservativeWindow =
    input.riskMode === 'conservative' &&
    (hourUtc < CONSERVATIVE_UTC_START || hourUtc > CONSERVATIVE_UTC_END);

  if (outsideConservativeWindow) {
    return {
      outcome: 'deferred',
      reasons: [
        `Conservative mode: deferred outside UTC window [${CONSERVATIVE_UTC_START}, ${CONSERVATIVE_UTC_END}] (current hour UTC: ${hourUtc})`,
      ],
    };
  }

  const limit = THRESHOLDS_USD[input.riskMode];
  if (input.notionalUsd > limit) {
    return {
      outcome: 'rejected',
      reasons: [
        `Notional ${input.notionalUsd} exceeds ${input.riskMode} threshold ${limit} USD`,
      ],
    };
  }

  return {
    outcome: 'approved',
    reasons: [`Within ${input.riskMode} notional limit (${limit} USD)`],
  };
}
