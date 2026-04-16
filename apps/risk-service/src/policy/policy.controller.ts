import { Controller, Get } from '@nestjs/common';

import { PolicyProfilesService } from './policy-profiles.service';

/**
 * Readiness + read APIs for Phase 2.2 policy (`P2-2.2-PROF` / `ADRISK` / `PLAY`).
 */
@Controller('policy')
export class PolicyController {
  constructor(private readonly profiles: PolicyProfilesService) {}

  @Get('phase2-readiness')
  phase2Readiness(): {
    readonly tokenProfiles: 'implemented';
    readonly adaptiveRisk: 'partial';
    readonly playbooks: 'partial';
    readonly schemaVersion: 2;
  } {
    return {
      tokenProfiles: 'implemented',
      adaptiveRisk: 'partial',
      playbooks: 'partial',
      schemaVersion: 2,
    };
  }

  @Get('token-profiles')
  async listTokenProfiles(): Promise<
    Awaited<ReturnType<PolicyProfilesService['listTokenProfiles']>>
  > {
    return this.profiles.listTokenProfiles();
  }

  @Get('route-profiles')
  async listRouteProfiles(): Promise<
    Awaited<ReturnType<PolicyProfilesService['listRouteProfiles']>>
  > {
    return this.profiles.listRouteProfiles();
  }
}
