import {
  Controller,
  ForbiddenException,
  Headers,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';

import { PolicyJobsService } from './policy-jobs.service';

function assertJobTrigger(headers: Record<string, string | string[] | undefined>): void {
  const expected = process.env.RISK_POLICY_JOB_TRIGGER_TOKEN?.trim();
  if (expected === undefined || expected.length === 0) {
    throw new ServiceUnavailableException(
      'RISK_POLICY_JOB_TRIGGER_TOKEN is not configured on this instance',
    );
  }
  const raw = headers['x-arbibot-job-trigger'] ?? headers['X-Arbibot-Job-Trigger'];
  const token = Array.isArray(raw) ? raw[0] : raw;
  if (token === undefined || token.trim() !== expected) {
    throw new ForbiddenException('Invalid job trigger token');
  }
}

@Controller('policy/jobs')
export class PolicyJobsController {
  constructor(private readonly jobs: PolicyJobsService) {}

  @Post('watchlist-tiering')
  async runWatchlistTiering(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<Awaited<ReturnType<PolicyJobsService['runWatchlistTiering']>>> {
    assertJobTrigger(headers);
    return this.jobs.runWatchlistTiering('http');
  }

  @Post('route-scoring')
  async runRouteScoring(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<Awaited<ReturnType<PolicyJobsService['runRouteScoring']>>> {
    assertJobTrigger(headers);
    return this.jobs.runRouteScoring('http');
  }
}
