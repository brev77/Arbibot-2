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
} from '@nestjs/common';

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
}
