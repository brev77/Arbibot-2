import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';

import { OnChainTransaction } from '@arbibot/persistence';

import { CreateMultiLegPlanDto } from './dto/create-multi-leg-plan.dto';
import { MultiLegPlanBuilderService } from './multi-leg-plan-builder.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { LinkReservationDto } from './dto/link-reservation.dto';
import type { DexPlanEnrichment } from './plans.service';
import { PlansService } from './plans.service';

function planView(
  row: Awaited<ReturnType<PlansService['getById']>>,
  dex: DexPlanEnrichment,
) {
  return {
    id: row.id,
    state: row.state,
    correlationId: row.correlationId,
    capitalReservationId: row.capitalReservationId,
    riskDecisionId: row.riskDecisionId,
    routeKey: row.routeKey,
    entityVersion: row.entityVersion,
    venueType: dex.venueType,
    chainId: dex.chainId,
    dexAdapter: dex.dexAdapter,
    txHash: dex.txHash,
    txStatus: dex.txStatus,
    gasUsedWei: dex.gasUsedWei,
    gasCostUsd: dex.gasCostUsd,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Controller('execution/plans')
export class PlansController {
  constructor(
    private readonly service: PlansService,
    private readonly multiLegBuilder: MultiLegPlanBuilderService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreatePlanDto) {
    const row = await this.service.create(body);
    const dex = await this.service.getDexEnrichment(row.id);
    return planView(row, dex);
  }

  /** Create a multi-leg cross-chain execution plan (DEX-2-2-PLAN). */
  @Post('multi-leg')
  @HttpCode(HttpStatus.CREATED)
  async createMultiLeg(@Body() body: CreateMultiLegPlanDto) {
    const { plan, config } = await this.multiLegBuilder.buildMultiLegPlan(body);
    const dex = await this.service.getDexEnrichment(plan.id);
    return {
      ...planView(plan, dex),
      playbookConfig: config,
    };
  }

  @Get()
  async list() {
    const items = await this.service.list();
    const enriched = await Promise.all(
      items.map(async (r) => {
        const dex = await this.service.getDexEnrichment(r.id);
        return planView(r, dex);
      }),
    );
    return { items: enriched };
  }

  @Get(':id')
  async getOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    const row = await this.service.getById(id);
    const dex = await this.service.getDexEnrichment(id);
    return planView(row, dex);
  }

  @Post(':id/link-reservation')
  @HttpCode(HttpStatus.OK)
  async link(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: LinkReservationDto,
  ) {
    const row = await this.service.linkReservation(
      id,
      body.capitalReservationId,
    );
    const dex = await this.service.getDexEnrichment(id);
    return planView(row, dex);
  }

  @Post(':id/arm')
  @HttpCode(HttpStatus.OK)
  async arm(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    const row = await this.service.arm(id);
    const dex = await this.service.getDexEnrichment(id);
    return planView(row, dex);
  }

  /** Get execution legs for a plan. */
  @Get(':id/legs')
  async getLegs(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    const legs = await this.service.getLegs(id);
    return {
      items: legs.map((leg) => ({
        id: leg.id,
        planId: leg.planId,
        legIndex: leg.legIndex,
        state: leg.state,
        entityVersion: leg.entityVersion,
        venueRef: leg.venueRef,
        targetQuantity: leg.targetQuantity,
        filledQuantity: leg.filledQuantity,
        createdAt: leg.createdAt.toISOString(),
        updatedAt: leg.updatedAt.toISOString(),
      })),
    };
  }

  /** Get on-chain transactions for all legs of a plan. */
  @Get(':id/on-chain-txs')
  async getOnChainTxs(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    const txs = await this.service.getOnChainTxsForPlan(id);
    return { items: txs.map(onChainTxView) };
  }
}

/** Serialize an OnChainTransaction for API responses. */
function onChainTxView(tx: OnChainTransaction) {
  return {
    id: tx.id,
    txHash: tx.txHash,
    chainId: tx.chainId,
    legId: tx.legId,
    fromAddress: tx.fromAddress,
    toAddress: tx.toAddress,
    value: tx.value,
    gasLimit: tx.gasLimit,
    gasUsed: tx.gasUsed,
    gasPrice: tx.gasPrice,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
    maxFeePerGas: tx.maxFeePerGas,
    status: tx.status,
    blockNumber: tx.blockNumber,
    blockHash: tx.blockHash,
    transactionIndex: tx.transactionIndex,
    confirmations: tx.confirmations,
    confirmedAt: tx.confirmedAt?.toISOString() ?? null,
    revertReason: tx.revertReason,
    errorMessage: tx.errorMessage,
    nonce: tx.nonce,
    createdAt: tx.createdAt.toISOString(),
    updatedAt: tx.updatedAt.toISOString(),
  };
}
