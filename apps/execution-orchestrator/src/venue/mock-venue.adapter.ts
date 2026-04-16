import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { ExecutionLegEntity, ExecutionPlanEntity } from '@arbibot/persistence';

import type { VenueAdapter, VenueLegSubmitResult, VenueLegTerminalState } from './venue-adapter';
import { VenueSubmitTransientError, VenueTerminalSubmitError } from './venue-adapter';

function readInitialSubmitFailures(): number {
  const raw = process.env.MOCK_VENUE_FAIL_SUBMIT_REMAINING?.trim() ?? '';
  if (raw.length === 0) {
    return 0;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function readTerminalLegIndex(): number | null {
  const raw = process.env.MOCK_VENUE_TERMINAL_LEG_INDEX?.trim() ?? '';
  if (raw.length === 0) {
    return null;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function readTerminalState(): VenueLegTerminalState | null {
  const raw = (process.env.MOCK_VENUE_TERMINAL_STATE ?? '').trim().toLowerCase();
  if (raw === 'rejected') {
    return 'rejected';
  }
  if (raw === 'timed_out' || raw === 'timedout') {
    return 'timedOut';
  }
  if (raw === 'failed') {
    return 'failed';
  }
  return null;
}

/** Deterministic sandbox: no external network; suitable for controlled execution tests. */
@Injectable()
export class MockVenueAdapter implements VenueAdapter {
  private submitFailuresRemaining = readInitialSubmitFailures();

  submitLeg(
    _plan: ExecutionPlanEntity,
    leg: ExecutionLegEntity,
  ): Promise<VenueLegSubmitResult> {
    const terminalIdx = readTerminalLegIndex();
    const terminalState = readTerminalState();
    if (
      terminalIdx !== null &&
      terminalState !== null &&
      leg.legIndex === terminalIdx
    ) {
      return Promise.reject(
        new VenueTerminalSubmitError(
          `Mock venue terminal submit (MOCK_VENUE_TERMINAL_LEG_INDEX=${terminalIdx}, state=${terminalState})`,
          terminalState,
        ),
      );
    }
    if (this.submitFailuresRemaining > 0) {
      this.submitFailuresRemaining -= 1;
      return Promise.reject(
        new VenueSubmitTransientError(
          'Mock venue injected failure (MOCK_VENUE_FAIL_SUBMIT_REMAINING)',
        ),
      );
    }
    return Promise.resolve({
      externalOrderId: `mock:${leg.id}:${randomUUID().slice(0, 8)}`,
    });
  }
}
