import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';

import { PaperDriftService } from './paper-drift.service';
import { CreateDriftSampleDto } from './dto/create-drift-sample.dto';

function driftView(row: Awaited<ReturnType<PaperDriftService['list']>>[number]) {
  return {
    id: row.id,
    instrumentKey: row.instrumentKey,
    paperMid: row.paperMid,
    referenceMid: row.referenceMid,
    driftBps: row.driftBps,
    capturedAt: row.capturedAt.toISOString(),
  };
}

@Controller('paper/drift-samples')
export class PaperDriftController {
  constructor(private readonly service: PaperDriftService) {}

  @Get()
  async list(
    @Query('instrumentKey') instrumentKey?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const limit = limitRaw !== undefined ? Number.parseInt(limitRaw, 10) : 50;
    const rows = await this.service.list(instrumentKey, Number.isNaN(limit) ? 50 : limit);
    return { items: rows.map((r) => driftView(r)) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreateDriftSampleDto) {
    const row = await this.service.record(body);
    return driftView(row);
  }
}
