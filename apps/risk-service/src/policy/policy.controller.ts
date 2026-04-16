import { Controller, Get } from '@nestjs/common';

/**
 * Readiness surface for Phase 2.2 policy work (`P2-2.2-PROF` / `ADRISK` / `PLAY`).
 * Full TokenProfile / adaptive sizing / playbooks remain separate implementation steps.
 */
@Controller('policy')
export class PolicyController {
  @Get('phase2-readiness')
  phase2Readiness(): {
    readonly tokenProfiles: 'planned';
    readonly adaptiveRisk: 'planned';
    readonly playbooks: 'planned';
    readonly schemaVersion: 1;
  } {
    return {
      tokenProfiles: 'planned',
      adaptiveRisk: 'planned',
      playbooks: 'planned',
      schemaVersion: 1,
    };
  }
}
