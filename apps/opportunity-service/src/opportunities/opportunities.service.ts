  import {
    ConflictException,
    Injectable,
    NotFoundException,
  } from '@nestjs/common';
  import { randomUUID } from 'node:crypto';

  import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  IsNull,
  MoreThanOrEqual,
  QueryFailedError,
  Repository,
} from 'typeorm';

import {
  EVENT_NAMES,
  OPPORTUNITY_DETECTED_PAYLOAD_SCHEMA_VERSION,
  PAPER_PROMOTION_CANDIDATE_REQUESTED_PAYLOAD_SCHEMA_VERSION,
  type OpportunityDetectedPayloadV1,
  type PaperPromotionCandidateRequestedPayloadV1,
  SERVICE_IDS,
} from '@arbibot/contracts';
  import { getCorrelationId } from '@arbibot/nest-platform';
  import { ArbitrageOpportunityEntity, OutboxEventEntity } from '@arbibot/persistence';

  import type { CreateOpportunityDto } from './dto/create-opportunity.dto';
  import type { EnrichOpportunityDto } from './dto/enrich-opportunity.dto';
  import type { PaperEnqueueDto } from './dto/paper-enqueue.dto';
  import type { RequestRiskEvaluationDto } from './dto/request-risk-evaluation.dto';
  import type {
    DexFiltersConfigDto,
    FiltersPreviewDto,
    FilterMetricsPeriodDto,
    FiltersMetricsDto,
  } from './dto/preview-filters.dto';
  import { OPPORTUNITY_STATES } from './opportunity-states';
  import { PaperClientService } from './paper-client.service';
  import { RiskClientService } from './risk-client.service';

function readStringFromPayload(
  payload: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = payload[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function readNumberFromPayload(
  payload: Record<string, unknown>,
  key: string,
): number | null {
  const v = payload[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Extract a free-form `evidence` block from the input payload. If the caller supplied an
 * `evidence` object, pass it through verbatim; otherwise capture the raw input blob (minus the
 * canonical fields already promoted to `OpportunityDetectedPayloadV1`) so pool addresses,
 * reserves, gas estimates etc. survive for observability/future consumers.
 */
function extractEvidence(input: Record<string, unknown>): Record<string, unknown> {
  const evidence = input['evidence'];
  if (
    typeof evidence === 'object' &&
    evidence !== null &&
    !Array.isArray(evidence)
  ) {
    return evidence as Record<string, unknown>;
  }
  const promoted = new Set([
    'instrumentKey',
    'routeKey',
    'sourceModule',
    'spreadBps',
    'grossProfitUsd',
    'netProfitUsd',
    'profitUsd',
    'feesUsd',
    'volumeUsd',
    'buyVenue',
    'sellVenue',
    'chainId',
    'token',
    'quoteAsset',
    'evidence',
    'spreadPct',
    'riskLevel',
    'poolAddresses',
  ]);
  const passthrough: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!promoted.has(k)) {
      passthrough[k] = v;
    }
  }
  return passthrough;
}

function isPostgresUniqueViolation(err: unknown): boolean {
  if (err instanceof QueryFailedError) {
    const code = (err.driverError as { code?: string } | undefined)?.code;
    return code === '23505';
  }
  return (err as { code?: string } | undefined)?.code === '23505';
}

export type RequestRiskEvaluationResult = {
  readonly opportunity: ArbitrageOpportunityEntity;
  readonly riskDecisionId: string;
  readonly riskOutcome: string;
  readonly idempotentReplay: boolean;
};

@Injectable()
export class OpportunitiesService {
  constructor(
    @InjectRepository(ArbitrageOpportunityEntity)
    private readonly repo: Repository<ArbitrageOpportunityEntity>,
    private readonly dataSource: DataSource,
    private readonly riskClient: RiskClientService,
    private readonly paperClient: PaperClientService,
  ) {}

  /**
   * Create a detected-state opportunity AND emit an `OpportunityDetected` outbox row in a
   * single transaction (Phase 3b — S3-3-PHASE3B).
   *
   * Mirrors `paperEnqueue()` (opportunities.service.ts) — same file, same service, same
   * dataSource + OutboxEventEntity wiring. `dataSource` already injected (constructor),
   * `OutboxEventEntity` already imported — no new dependencies.
   *
   * `OpportunityDetected` is purely observational: 0 consumers today, but the contract is
   * materialized for Hermes / UI async / future auto-enricher. It does NOT drive
   * `detected → risk_checked` (that requires `RiskDecisionIssued` via request-risk-evaluation).
   *
   * Payload.sourceModule reflects the *originating* module (e.g. 'scanner-service') when the
   * caller supplied it; envelope.sourceModule is always `SERVICE_IDS.opportunityService` because
   * opportunity-service is the single-writer that emits the outbox row.
   */
  async create(dto: CreateOpportunityDto): Promise<ArbitrageOpportunityEntity> {
    return this.dataSource.transaction(async (em: EntityManager) => {
      const row = em.create(ArbitrageOpportunityEntity, {
        correlationId: dto.correlationId ?? null,
        state: OPPORTUNITY_STATES.detected,
        riskDecisionId: null,
        payload: dto.payload ?? {},
        entityVersion: 1,
      });
      const saved = await em.save(ArbitrageOpportunityEntity, row);
      await this.writeOpportunityDetectedOutbox(em, saved);
      return saved;
    });
  }

  /**
   * Write the `OpportunityDetected` outbox row (envelope + payload per contracts/events.ts).
   * The payload is derived from the caller-supplied `payload` blob (scanner-service writes
   * `OpportunityDetectedPayloadV1` fields there); fields absent on the row default to null.
   */
  private async writeOpportunityDetectedOutbox(
    em: EntityManager,
    opp: ArbitrageOpportunityEntity,
  ): Promise<void> {
    const messageId = randomUUID();
    const createdAt = new Date();
    const correlationId =
      typeof opp.correlationId === 'string' && opp.correlationId.length > 0
        ? opp.correlationId
        : opp.id;
    const input = (opp.payload ?? {});
    const payload: OpportunityDetectedPayloadV1 = {
      opportunityId: opp.id,
      instrumentKey: readStringFromPayload(input, 'instrumentKey') ?? null,
      routeKey: readStringFromPayload(input, 'routeKey') ?? null,
      sourceModule: readStringFromPayload(input, 'sourceModule') ?? 'manual',
      spreadBps: readNumberFromPayload(input, 'spreadBps'),
      grossProfitUsd: readNumberFromPayload(input, 'grossProfitUsd') ?? readNumberFromPayload(input, 'profitUsd'),
      netProfitUsd: readNumberFromPayload(input, 'netProfitUsd') ?? readNumberFromPayload(input, 'profitUsd'),
      feesUsd: readNumberFromPayload(input, 'feesUsd'),
      volumeUsd: readNumberFromPayload(input, 'volumeUsd'),
      buyVenue: readStringFromPayload(input, 'buyVenue') ?? null,
      sellVenue: readStringFromPayload(input, 'sellVenue') ?? null,
      chainId: readNumberFromPayload(input, 'chainId'),
      token: readStringFromPayload(input, 'token') ?? null,
      quoteAsset: readStringFromPayload(input, 'quoteAsset') ?? null,
      evidence: extractEvidence(input),
    };
    const envelope = {
      messageId,
      correlationId,
      causationId: opp.id,
      entityType: 'ArbitrageOpportunity',
      entityId: opp.id,
      version: OPPORTUNITY_DETECTED_PAYLOAD_SCHEMA_VERSION,
      sourceModule: SERVICE_IDS.opportunityService,
      eventTs: createdAt.toISOString(),
      eventName: EVENT_NAMES.opportunityDetected,
      payload,
    };
    const outbox = em.create(OutboxEventEntity, {
      messageId,
      eventType: EVENT_NAMES.opportunityDetected,
      entityType: 'ArbitrageOpportunity',
      entityId: opp.id,
      schemaVersion: OPPORTUNITY_DETECTED_PAYLOAD_SCHEMA_VERSION,
      payload: payload as unknown as Record<string, unknown>,
      envelope: envelope as unknown as Record<string, unknown>,
      processedAt: null,
    });
    await em.save(OutboxEventEntity, outbox);
  }

  async list(): Promise<ArbitrageOpportunityEntity[]> {
    return this.repo.find({ order: { createdAt: 'DESC' }, take: 100 });
  }

  async getById(id: string): Promise<ArbitrageOpportunityEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  async enrich(
    id: string,
    dto: EnrichOpportunityDto,
  ): Promise<ArbitrageOpportunityEntity> {
    return this.dataSource.transaction(async (em) => {
      const opp = await em.findOne(ArbitrageOpportunityEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (opp === null) {
        throw new NotFoundException(`Opportunity not found: ${id}`);
      }
      if (opp.state !== OPPORTUNITY_STATES.detected) {
        throw new ConflictException(
          `Enrich requires state ${OPPORTUNITY_STATES.detected}, got ${opp.state}`,
        );
      }
      opp.state = OPPORTUNITY_STATES.enriched;
      if (dto.payloadPatch !== undefined) {
        opp.payload = { ...opp.payload, ...dto.payloadPatch };
      }
      opp.entityVersion += 1;
      return em.save(ArbitrageOpportunityEntity, opp);
    });
  }

  async requestRiskEvaluation(
    id: string,
    dto: RequestRiskEvaluationDto,
  ): Promise<RequestRiskEvaluationResult> {
    const existing = await this.repo.findOne({ where: { id } });
    if (existing === null) {
      throw new NotFoundException(`Opportunity not found: ${id}`);
    }
    if (existing.state === OPPORTUNITY_STATES.riskChecked) {
      if (existing.riskDecisionId === null) {
        throw new ConflictException(
          'Opportunity is risk_checked but risk_decision_id is missing',
        );
      }
      return {
        opportunity: existing,
        riskDecisionId: existing.riskDecisionId,
        riskOutcome: 'skipped',
        idempotentReplay: true,
      };
    }

    const correlationId =
      dto.correlationId ??
      this.riskClient.correlationIdForOpportunity(existing.correlationId);

    await this.dataSource.transaction(async (em) => {
      const opp = await em.findOne(ArbitrageOpportunityEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (opp === null) {
        throw new NotFoundException(`Opportunity not found: ${id}`);
      }
      if (opp.state === OPPORTUNITY_STATES.riskChecked) {
        return;
      }
      if (opp.state === OPPORTUNITY_STATES.detected) {
        opp.state = OPPORTUNITY_STATES.enriched;
        opp.entityVersion += 1;
      }
      if (opp.correlationId === null && dto.correlationId !== undefined) {
        opp.correlationId = dto.correlationId;
      }
      if (
        opp.correlationId === null &&
        dto.correlationId === undefined &&
        correlationId.length > 0
      ) {
        opp.correlationId = correlationId;
      }
      await em.save(ArbitrageOpportunityEntity, opp);
      if (opp.state !== OPPORTUNITY_STATES.enriched) {
        throw new ConflictException(
          `Risk evaluation requires state ${OPPORTUNITY_STATES.enriched}, got ${opp.state}`,
        );
      }
    });

    const afterPrepare = await this.repo.findOne({ where: { id } });
    if (
      afterPrepare !== null &&
      afterPrepare.state === OPPORTUNITY_STATES.riskChecked &&
      afterPrepare.riskDecisionId !== null
    ) {
      return {
        opportunity: afterPrepare,
        riskDecisionId: afterPrepare.riskDecisionId,
        riskOutcome: 'skipped',
        idempotentReplay: true,
      };
    }

    const traceCorrelationId = getCorrelationId() ?? correlationId;
    const risk = await this.riskClient.evaluateRisk(
      {
        correlationId,
        planReference: id,
        notionalUsd: dto.notionalUsd,
        snapshotVersion: dto.snapshotVersion,
        riskMode: dto.riskMode,
        idempotencyKey: dto.idempotencyKey,
        riskWindowReservationId: dto.riskWindowReservationId,
      },
      { traceCorrelationId },
    );

    return this.dataSource.transaction(async (em) => {
      const opp = await em.findOne(ArbitrageOpportunityEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (opp === null) {
        throw new NotFoundException(`Opportunity not found: ${id}`);
      }
      if (
        opp.state === OPPORTUNITY_STATES.riskChecked &&
        opp.riskDecisionId === risk.riskDecisionId
      ) {
        return {
          opportunity: opp,
          riskDecisionId: risk.riskDecisionId,
          riskOutcome: risk.outcome,
          idempotentReplay: true,
        };
      }
      if (opp.state === OPPORTUNITY_STATES.riskChecked) {
        throw new ConflictException(
          'Opportunity already risk_checked with a different risk decision',
        );
      }
      if (opp.state !== OPPORTUNITY_STATES.enriched) {
        throw new ConflictException(
          `Risk evaluation requires state ${OPPORTUNITY_STATES.enriched}, got ${opp.state}`,
        );
      }
      opp.state = OPPORTUNITY_STATES.riskChecked;
      opp.riskDecisionId = risk.riskDecisionId;
      opp.entityVersion += 1;
      const saved = await em.save(ArbitrageOpportunityEntity, opp);
      return {
        opportunity: saved,
        riskDecisionId: risk.riskDecisionId,
        riskOutcome: risk.outcome,
        idempotentReplay: false,
      };
    });
  }

  async paperEnqueue(
    id: string,
    dto: PaperEnqueueDto,
  ): Promise<{
    enqueued: boolean;
    paperServiceConfigured: boolean;
    deduplicated?: boolean;
  }> {
    if (!this.paperClient.isEnabled()) {
      return { enqueued: false, paperServiceConfigured: false };
    }
    return this.dataSource.transaction(async (em) => {
      const opp = await em.findOne(ArbitrageOpportunityEntity, {
        where: { id },
      });
      if (opp === null) {
        throw new NotFoundException(`Opportunity not found: ${id}`);
      }
      const instrumentKey =
        dto.instrumentKey ??
        readStringFromPayload(opp.payload, 'instrumentKey') ??
        readStringFromPayload(opp.payload, 'routeKey') ??
        `arb:opportunity:${opp.id}`;
      const enqueueIdempotencyKey = `${opp.id}:${instrumentKey}`;
      const pending = await em.findOne(OutboxEventEntity, {
        where: {
          eventType: EVENT_NAMES.paperPromotionCandidateRequested,
          paperEnqueueIdempotencyKey: enqueueIdempotencyKey,
          processedAt: IsNull(),
          relayDeadLetterAt: IsNull(),
        },
      });
      if (pending !== null) {
        return {
          enqueued: true,
          paperServiceConfigured: true,
          deduplicated: true,
        };
      }
      const messageId = randomUUID();
      const createdAt = new Date();
      const correlationId =
        typeof opp.correlationId === 'string' && opp.correlationId.length > 0
          ? opp.correlationId
          : opp.id;
      // P/L fields copied from the opportunity payload so the AutoDriveWorker can settle
      // a paper trade without re-fetching the opportunity (no paper→live runtime coupling).
      // All optional; absent for non-arbitrage or pre-enrichment opportunities.
      const oppPayload =
        opp.payload && typeof opp.payload === 'object' ? opp.payload : {};
      const netProfitUsd = readNumberFromPayload(oppPayload, 'netProfitUsd') ?? undefined;
      const spreadBpsNum = readNumberFromPayload(oppPayload, 'spreadBps');
      const buyVenueStr = readStringFromPayload(oppPayload, 'buyVenue');
      const sellVenueStr = readStringFromPayload(oppPayload, 'sellVenue');
      const payload: PaperPromotionCandidateRequestedPayloadV1 = {
        opportunityId: opp.id,
        instrumentKey,
        source: 'opportunity_hook',
        enqueueIdempotencyKey,
        score: dto.score,
        driftBps: dto.driftBps,
        evidence: dto.evidence ?? {},
        ...(netProfitUsd !== undefined ? { netProfitUsd } : {}),
        ...(spreadBpsNum !== null ? { spreadBps: spreadBpsNum } : {}),
        ...(buyVenueStr !== undefined ? { buyVenue: buyVenueStr } : {}),
        ...(sellVenueStr !== undefined ? { sellVenue: sellVenueStr } : {}),
      };
      const envelope = {
        messageId,
        correlationId,
        causationId: opp.id,
        entityType: 'ArbitrageOpportunity',
        entityId: opp.id,
        version: PAPER_PROMOTION_CANDIDATE_REQUESTED_PAYLOAD_SCHEMA_VERSION,
        sourceModule: SERVICE_IDS.opportunityService,
        eventTs: createdAt.toISOString(),
        eventName: EVENT_NAMES.paperPromotionCandidateRequested,
        payload,
      };
      const outbox = em.create(OutboxEventEntity, {
        messageId,
        eventType: EVENT_NAMES.paperPromotionCandidateRequested,
        entityType: 'ArbitrageOpportunity',
        entityId: opp.id,
        schemaVersion: PAPER_PROMOTION_CANDIDATE_REQUESTED_PAYLOAD_SCHEMA_VERSION,
        payload: payload as unknown as Record<string, unknown>,
        envelope: envelope as unknown as Record<string, unknown>,
        processedAt: null,
        paperEnqueueIdempotencyKey: enqueueIdempotencyKey,
      });
      try {
        await em.save(OutboxEventEntity, outbox);
      } catch (err: unknown) {
        if (isPostgresUniqueViolation(err)) {
          return {
            enqueued: true,
            paperServiceConfigured: true,
            deduplicated: true,
          };
        }
        throw err;
      }
      return { enqueued: true, paperServiceConfigured: true };
    });
  }

  async previewFilters(
    filters: DexFiltersConfigDto,
  ): Promise<FiltersPreviewDto> {
    // Load all opportunities from the database
    const opportunities = await this.repo.find({
      where: {},
      take: 1000,
      order: { createdAt: 'DESC' },
    });

    const total = opportunities.length;
    const breakdown = {
      minSpreadPct: { count: 0, percentage: 0 },
      minProfitUsd: { count: 0, percentage: 0 },
      maxFeesUsd: { count: 0, percentage: 0 },
      volumeRange: { count: 0, percentage: 0 },
      blacklistTokens: { count: 0, percentage: 0 },
      allowedChains: { count: 0, percentage: 0 },
      quoteAssets: { count: 0, percentage: 0 },
      highRisk: { count: 0, percentage: 0 },
    };

    let filteredOut = 0;

    for (const opp of opportunities) {
      let isFiltered = false;

      // Extract values from payload
      const payload = opp.payload as Record<string, unknown> | undefined ?? {};
      const spreadPct = typeof payload.spreadPct === 'number' ? payload.spreadPct : 0;
      const profitUsd = typeof payload.profitUsd === 'number' ? payload.profitUsd : 0;
      const feesUsd = typeof payload.feesUsd === 'number' ? payload.feesUsd : 0;
      const volumeUsd = typeof payload.volumeUsd === 'number' ? payload.volumeUsd : 0;
      const token = typeof payload.token === 'string' ? payload.token : '';
      const chain = typeof payload.chain === 'string' ? payload.chain : '';
      const quoteAsset = typeof payload.quoteAsset === 'string' ? payload.quoteAsset : '';
      const riskLevel = typeof payload.riskLevel === 'string' ? payload.riskLevel : 'low';

      // Apply filters if enabled globally
      if (filters.enabled) {
        // Threshold filters
        if (filters.filters.minSpreadPct.enabled && spreadPct < filters.filters.minSpreadPct.value) {
          breakdown.minSpreadPct.count++;
          isFiltered = true;
        }
        if (filters.filters.minProfitUsd.enabled && profitUsd < filters.filters.minProfitUsd.value) {
          breakdown.minProfitUsd.count++;
          isFiltered = true;
        }
        if (filters.filters.maxFeesUsd.enabled && feesUsd > filters.filters.maxFeesUsd.value) {
          breakdown.maxFeesUsd.count++;
          isFiltered = true;
        }

        // Range filters
        if (filters.filters.volumeRange.enabled) {
          if (volumeUsd < filters.filters.volumeRange.min || volumeUsd > filters.filters.volumeRange.max) {
            breakdown.volumeRange.count++;
            isFiltered = true;
          }
        }

        // Blacklist/Whitelist filters
        if (filters.filters.blacklistTokens.enabled && filters.filters.blacklistTokens.tokens.includes(token)) {
          breakdown.blacklistTokens.count++;
          isFiltered = true;
        }
        if (filters.filters.allowedChains.enabled && !filters.filters.allowedChains.chains.includes(chain)) {
          breakdown.allowedChains.count++;
          isFiltered = true;
        }
        if (filters.filters.quoteAssets.enabled && !filters.filters.quoteAssets.assets.includes(quoteAsset)) {
          breakdown.quoteAssets.count++;
          isFiltered = true;
        }

        // Risk filters
        if (filters.filters.highRisk.enabled) {
          const riskOrder: Record<string, number> = { low: 1, medium: 2, high: 3 };
          const currentRiskLevel = riskLevel;
          const maxRiskLevel = filters.filters.highRisk.maxRiskLevel as keyof typeof riskOrder;
          const currentLevel = riskOrder[currentRiskLevel] ?? 1;
          const maxLevel = riskOrder[maxRiskLevel] ?? 3;
          if (currentLevel > maxLevel) {
            breakdown.highRisk.count++;
            isFiltered = true;
          }
        }
      }

      if (isFiltered) {
        filteredOut++;
      }
    }

    // Calculate percentages
    const filteredPercentage = total > 0 ? (filteredOut / total) * 100 : 0;
    Object.values(breakdown).forEach((item) => {
      item.percentage = total > 0 ? (item.count / total) * 100 : 0;
    });

    return {
      totalOpportunities: total,
      filteredOut,
      filteredPercentage,
      breakdown,
    };
  }

  async getMetrics(): Promise<FiltersMetricsDto> {
    const now = new Date();
    
    // Define time ranges
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Count opportunities in each time range
    const [last1h, last24h, last7d] = await Promise.all([
      this.repo.count({ where: { createdAt: MoreThanOrEqual(oneHourAgo) } }),
      this.repo.count({ where: { createdAt: MoreThanOrEqual(twentyFourHoursAgo) } }),
      this.repo.count({ where: { createdAt: MoreThanOrEqual(sevenDaysAgo) } }),
    ]);

    // For now, return mock breakdown data
    // In production, this would come from actual filter application metrics
    const createMockBreakdown = (total: number) => ({
      minSpreadPct: Math.floor(total * 0.03),
      minProfitUsd: Math.floor(total * 0.05),
      maxFeesUsd: Math.floor(total * 0.02),
      volumeRange: Math.floor(total * 0.04),
      blacklistTokens: Math.floor(total * 0.01),
      allowedChains: Math.floor(total * 0.01),
      quoteAssets: Math.floor(total * 0.02),
      highRisk: Math.floor(total * 0.01),
    });

    const createPeriodMetrics = (total: number): FilterMetricsPeriodDto => {
      const breakdown = createMockBreakdown(total);
      const rejectedByFilters = Object.values(breakdown).reduce((sum, val) => sum + val, 0);
      
      return {
        totalOpportunities: total,
        passedFilters: total - rejectedByFilters,
        rejectedByFilters,
        breakdown,
      };
    };

    return {
      last1h: createPeriodMetrics(last1h),
      last24h: createPeriodMetrics(last24h),
      last7d: createPeriodMetrics(last7d),
    };
  }
}
