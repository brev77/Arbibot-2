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
  /** When set, notional must not exceed `min(modeThreshold, profileMaxNotionalUsd)`. */
  readonly profileMaxNotionalUsd?: number;
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

  const modeLimit = THRESHOLDS_USD[input.riskMode];
  const profileCap = input.profileMaxNotionalUsd;
  const effectiveLimit =
    profileCap === undefined
      ? modeLimit
      : Math.min(modeLimit, profileCap);

  if (input.notionalUsd > effectiveLimit) {
    const capNote =
      profileCap === undefined
        ? `${input.riskMode} threshold ${modeLimit} USD`
        : `effective cap ${effectiveLimit} USD (mode ${modeLimit} USD, profile ${profileCap} USD)`;
    return {
      outcome: 'rejected',
      reasons: [`Notional ${input.notionalUsd} exceeds ${capNote}`],
    };
  }

  return {
    outcome: 'approved',
    reasons: [
      profileCap === undefined
        ? `Within ${input.riskMode} notional limit (${modeLimit} USD)`
        : `Within ${input.riskMode} limit and profile cap (${effectiveLimit} USD)`,
    ],
  };
}
