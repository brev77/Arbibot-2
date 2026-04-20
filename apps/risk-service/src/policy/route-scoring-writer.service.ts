import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RiskDecisionEntity } from '@arbibot/persistence';

import { getPolicyWriterMetrics } from './policy-metrics';
import { RouteProfileService } from './route-profile.service';
import { RouteScoringHistoryService } from './route-scoring-history.service';

function parsePositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return n;
}

function parsePositiveUsd(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return n;
}

function clamp01(n: number): number {
  if (n < 0) {
    return 0;
  }
  if (n > 1) {
    return 1;
  }
  return n;
}

function notionalFactor(maxNotionalUsd: number, capRef: number): number {
  const nf =
    Math.log10(1 + Math.max(0, maxNotionalUsd)) / Math.log10(1 + Math.max(1, capRef));
  return clamp01(nf);
}

function roundScore6(score: number): number {
  return Math.round(score * 1e6) / 1e6;
}

export type RouteScoringRunSummary = {
  readonly routesEvaluated: number;
  readonly rowsWritten: number;
};

/**
 * Background writer: route_profiles + risk_decisions → route_scoring_history.
 */
@Injectable()
export class RouteScoringWriterService {
  private readonly log = new Logger(RouteScoringWriterService.name);

  constructor(
    private readonly routes: RouteProfileService,
    private readonly scoring: RouteScoringHistoryService,
    @InjectRepository(RiskDecisionEntity)
    private readonly decisions: Repository<RiskDecisionEntity>,
  ) {}

  async runCycle(): Promise<RouteScoringRunSummary> {
    const m = getPolicyWriterMetrics();
    const lookbackHours = parsePositiveInt('ROUTE_SCORING_LOOKBACK_HOURS', 24);
    const capRef = parsePositiveUsd('ROUTE_SCORING_NOTIONAL_REF_USD', 5_000_000);
    const since = new Date(Date.now() - lookbackHours * 3600_000);
    const modelVersion = `risk_v1_${lookbackHours}h`;

    const { items: routeItems } = await this.routes.list();
    let rowsWritten = 0;

    for (const route of routeItems) {
      m.routeEvaluations.inc();
      const raw = await this.decisions
        .createQueryBuilder('d')
        .select('COUNT(*)', 'total')
        .addSelect(
          "SUM(CASE WHEN d.outcome = 'approved' THEN 1 ELSE 0 END)",
          'approved',
        )
        .where('d.route_key = :rk', { rk: route.routeKey })
        .andWhere('d.created_at >= :since', { since })
        .getRawOne<{ total: string; approved: string | null }>();

      const total = Number(raw?.total ?? 0);
      const approved = Number(raw?.approved ?? 0);
      const approvalRatio =
        total === 0 ? 0.5 : Math.min(1, Math.max(0, approved / total));

      const nf = notionalFactor(route.maxNotionalUsd, capRef);
      const score = roundScore6(clamp01(0.7 * approvalRatio + 0.3 * nf));

      const latest = await this.scoring.findLatestForRoute(route.routeKey);
      if (
        latest !== null &&
        roundScore6(Number(latest.score)) === score &&
        latest.modelVersion === modelVersion
      ) {
        continue;
      }

      await this.scoring.append(route.routeKey, score, modelVersion);
      m.routeChanges.inc();
      m.routeScoreDistribution.observe(score);
      rowsWritten += 1;
    }

    this.log.debug(
      `route scoring: evaluated=${routeItems.length} written=${rowsWritten} lookback=${lookbackHours}h`,
    );
    return { routesEvaluated: routeItems.length, rowsWritten };
  }
}
