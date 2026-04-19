import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UnauthorizedException,
} from '@nestjs/common';

import { PaperDiscoveryService } from '../paper-discovery/paper-discovery.service';
import { CreateOpportunityDto } from './dto/create-opportunity.dto';
import { EnrichOpportunityDto } from './dto/enrich-opportunity.dto';
import { PaperEnqueueDto } from './dto/paper-enqueue.dto';
import { RequestRiskEvaluationDto } from './dto/request-risk-evaluation.dto';
import { OpportunitiesService } from './opportunities.service';

@Controller('opportunities')
export class OpportunitiesController {
  constructor(
    private readonly service: OpportunitiesService,
    private readonly paperDiscovery: PaperDiscoveryService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreateOpportunityDto) {
    const row = await this.service.create(body);
    return {
      id: row.id,
      state: row.state,
      correlationId: row.correlationId,
      riskDecisionId: row.riskDecisionId,
      entityVersion: row.entityVersion,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Manual paper discovery scan (token from `PAPER_DISCOVERY_RUN_TOKEN`). */
  @Post('paper-discovery/run')
  @HttpCode(HttpStatus.OK)
  async runPaperDiscovery(
    @Headers('x-paper-discovery-token') token: string | undefined,
  ) {
    const expected = process.env.PAPER_DISCOVERY_RUN_TOKEN?.trim();
    if (expected === undefined || expected.length === 0) {
      throw new NotFoundException();
    }
    if (token !== expected) {
      throw new UnauthorizedException();
    }
    return this.paperDiscovery.discoverPaperOpportunities();
  }

  @Post(':id/enrich')
  @HttpCode(HttpStatus.OK)
  async enrich(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: EnrichOpportunityDto,
  ) {
    const row = await this.service.enrich(id, body);
    return {
      id: row.id,
      state: row.state,
      correlationId: row.correlationId,
      riskDecisionId: row.riskDecisionId,
      payload: row.payload,
      entityVersion: row.entityVersion,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  @Post(':id/paper-enqueue')
  @HttpCode(HttpStatus.OK)
  async paperEnqueue(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: PaperEnqueueDto,
  ) {
    return this.service.paperEnqueue(id, body);
  }

  @Post(':id/request-risk-evaluation')
  @HttpCode(HttpStatus.OK)
  async requestRiskEvaluation(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: RequestRiskEvaluationDto,
  ) {
    const r = await this.service.requestRiskEvaluation(id, body);
    return {
      opportunityId: r.opportunity.id,
      state: r.opportunity.state,
      correlationId: r.opportunity.correlationId,
      riskDecisionId: r.riskDecisionId,
      riskOutcome: r.riskOutcome,
      idempotentReplay: r.idempotentReplay,
      entityVersion: r.opportunity.entityVersion,
      updatedAt: r.opportunity.updatedAt.toISOString(),
    };
  }

  @Get()
  async list() {
    const items = await this.service.list();
    return {
      items: items.map((row) => ({
        id: row.id,
        state: row.state,
        correlationId: row.correlationId,
        riskDecisionId: row.riskDecisionId,
        entityVersion: row.entityVersion,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  @Get(':id')
  async getOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    const row = await this.service.getById(id);
    if (row === null) {
      throw new NotFoundException(`Opportunity not found: ${id}`);
    }
    return {
      id: row.id,
      state: row.state,
      correlationId: row.correlationId,
      riskDecisionId: row.riskDecisionId,
      payload: row.payload,
      entityVersion: row.entityVersion,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
