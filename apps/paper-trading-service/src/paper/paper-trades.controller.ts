import {
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
  Req,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';

import { PaperTradesService } from './paper-trades.service';
import { CreatePaperTradeDto } from './dto/create-paper-trade.dto';
import { PatchPaperTradeDto } from './dto/patch-paper-trade.dto';

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
}
