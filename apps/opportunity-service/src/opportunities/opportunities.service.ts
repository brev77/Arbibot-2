import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { getCorrelationId } from '@arbibot/nest-platform';
import { ArbitrageOpportunityEntity } from '@arbibot/persistence';

import type { CreateOpportunityDto } from './dto/create-opportunity.dto';
import type { EnrichOpportunityDto } from './dto/enrich-opportunity.dto';
import type { RequestRiskEvaluationDto } from './dto/request-risk-evaluation.dto';
import { OPPORTUNITY_STATES } from './opportunity-states';
import { RiskClientService } from './risk-client.service';

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
  ) {}

  async create(dto: CreateOpportunityDto): Promise<ArbitrageOpportunityEntity> {
    const row = this.repo.create({
      correlationId: dto.correlationId ?? null,
      state: OPPORTUNITY_STATES.detected,
      riskDecisionId: null,
      payload: dto.payload ?? {},
      entityVersion: 1,
    });
    return this.repo.save(row);
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
}
