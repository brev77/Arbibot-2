import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';

import { PaperTradesService } from './paper-trades.service';
import { CreatePaperTradeDto } from './dto/create-paper-trade.dto';
import { PatchPaperTradeDto } from './dto/patch-paper-trade.dto';
import { SettlePaperTradeDto } from './dto/settle-paper-trade.dto';

function tradeView(row: Awaited<ReturnType<PaperTradesService['getById']>>) {
  if (row === null) {
    return null;
  }
  return {
    id: row.id,
    opportunityId: row.opportunityId,
    instrumentKey: row.instrumentKey,
    routeKey: row.routeKey,
    state: row.state,
    notional: row.notional,
    summary: row.summary,
    // PAD-2 settlement fields — NULL until state = 'settled'.
    entryPrice: row.entryPrice,
    exitPrice: row.exitPrice,
    profitUsd: row.profitUsd,
    settledAt: row.settledAt !== null ? row.settledAt.toISOString() : null,
    entityVersion: row.entityVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Controller('paper/trades')
export class PaperTradesController {
  constructor(private readonly service: PaperTradesService) {}

  @Get()
  async list() {
    const rows = await this.service.list();
    return { items: rows.map((r) => tradeView(r)) };
  }

  /** Settled paper trades in [from, to] for the operator history view. (PAD-6) */
  @Get('history')
  async history(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = parseHistoryQuery(from, to, limit);
    const rows = await this.service.history(parsed);
    return { items: rows.map((r) => tradeView(r)) };
  }

  /** Aggregate stats over settled trades in [from, to]. (PAD-6) */
  @Get('stats')
  async stats(@Query('from') from?: string, @Query('to') to?: string) {
    const parsed = parseHistoryQuery(from, to, undefined);
    return this.service.stats({ from: parsed.from, to: parsed.to });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreatePaperTradeDto) {
    const row = await this.service.create(body);
    return tradeView(row);
  }

  @Get(':id')
  async getOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const row = await this.service.getById(id);
    if (row === null) {
      throw new NotFoundException(`Paper trade not found: ${id}`);
    }
    return tradeView(row);
  }

  @Patch(':id')
  async patch(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: PatchPaperTradeDto,
  ) {
    const row = await this.service.patch(id, body);
    return tradeView(row);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: FastifyRequest,
  ) {
    const operatorId = (req.headers['x-operator-id'] as string) ?? 'unknown';
    const row = await this.service.approve(id, operatorId);
    return tradeView(row);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: FastifyRequest,
  ) {
    const operatorId = (req.headers['x-operator-id'] as string) ?? 'unknown';
    const row = await this.service.reject(id, operatorId);
    return tradeView(row);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: FastifyRequest,
  ) {
    const operatorId = (req.headers['x-operator-id'] as string) ?? 'unknown';
    const row = await this.service.cancel(id, operatorId);
    return tradeView(row);
  }

  @Post(':id/settle')
  @HttpCode(HttpStatus.OK)
  async settle(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: SettlePaperTradeDto,
    @Req() req: FastifyRequest,
  ) {
    const operatorId = (req.headers['x-operator-id'] as string) ?? 'unknown';
    const row = await this.service.settle(id, body, operatorId);
    return tradeView(row);
  }
}

/** Parse `from`/`to`/`limit` query params for /history and /stats. Throws 400 on bad input. */
function parseHistoryQuery(
  from: string | undefined,
  to: string | undefined,
  limit: string | undefined,
): { from?: Date; to?: Date; limit?: number } {
  const out: { from?: Date; to?: Date; limit?: number } = {};
  if (from !== undefined && from.length > 0) {
    const d = new Date(from);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(`Invalid 'from' date: ${from}`);
    }
    out.from = d;
  }
  if (to !== undefined && to.length > 0) {
    const d = new Date(to);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(`Invalid 'to' date: ${to}`);
    }
    out.to = d;
  }
  if (limit !== undefined && limit.length > 0) {
    const n = Number.parseInt(limit, 10);
    if (!Number.isFinite(n)) {
      throw new BadRequestException(`Invalid 'limit': ${limit}`);
    }
    out.limit = n;
  }
  return out;
}
