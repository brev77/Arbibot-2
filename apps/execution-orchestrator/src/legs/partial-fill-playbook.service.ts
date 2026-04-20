import { BadRequestException, Injectable } from '@nestjs/common';

/**
 * JSON shape stored on {@link ExecutionPlanEntity.playbookConfig} (P2-2.2-PLAY).
 * Validated on write paths when orchestrator accepts playbook updates.
 */
export interface PartialFillPlaybookConfig {
  readonly partialFillStrategy?: 'continue' | 'hedge' | 'unwind';
  readonly driftBpsThreshold?: number;
  readonly maxPartialLegCommits?: number;
}

@Injectable()
export class PartialFillPlaybookService {
  parse(config: unknown): PartialFillPlaybookConfig {
    if (config === null || config === undefined) {
      return {};
    }
    if (typeof config !== 'object' || Array.isArray(config)) {
      throw new BadRequestException('playbook_config must be a JSON object');
    }
    const o = config as Record<string, unknown>;
    const partialFillStrategy = o.partialFillStrategy;
    if (
      partialFillStrategy !== undefined &&
      partialFillStrategy !== 'continue' &&
      partialFillStrategy !== 'hedge' &&
      partialFillStrategy !== 'unwind'
    ) {
      throw new BadRequestException('Invalid partialFillStrategy');
    }
    const driftBpsThreshold = o.driftBpsThreshold;
    if (driftBpsThreshold !== undefined) {
      if (typeof driftBpsThreshold !== 'number' || !Number.isFinite(driftBpsThreshold)) {
        throw new BadRequestException('driftBpsThreshold must be a finite number');
      }
    }
    const maxPartialLegCommits = o.maxPartialLegCommits;
    if (maxPartialLegCommits !== undefined) {
      if (
        typeof maxPartialLegCommits !== 'number' ||
        !Number.isInteger(maxPartialLegCommits) ||
        maxPartialLegCommits < 1
      ) {
        throw new BadRequestException('maxPartialLegCommits must be a positive integer');
      }
    }
    return {
      partialFillStrategy:
        partialFillStrategy === 'continue' ||
        partialFillStrategy === 'hedge' ||
        partialFillStrategy === 'unwind'
          ? partialFillStrategy
          : undefined,
      driftBpsThreshold:
        driftBpsThreshold !== undefined &&
        typeof driftBpsThreshold === 'number' &&
        Number.isFinite(driftBpsThreshold)
          ? driftBpsThreshold
          : undefined,
      maxPartialLegCommits:
        maxPartialLegCommits !== undefined &&
        typeof maxPartialLegCommits === 'number' &&
        Number.isInteger(maxPartialLegCommits) &&
        maxPartialLegCommits >= 1
          ? maxPartialLegCommits
          : undefined,
    };
  }
}
