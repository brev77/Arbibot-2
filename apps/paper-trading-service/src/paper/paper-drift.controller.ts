import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';

import { PaperDriftService } from './paper-drift.service';
import { PaperDriftWorker } from './paper-drift-worker';
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
  constructor(
    private readonly service: PaperDriftService,
    private readonly worker: PaperDriftWorker,
  ) {}

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

  /**
   * Manual trigger for the drift gauge self-heal cycle.
   *
   * Resolves Gap #3 from Drill #1: operator can force a `updateStaleGauges()`
   * cycle without restarting paper-trading-service or waiting for the periodic
   * worker interval. Useful for drill cleanup and incident resolution.
   *
   * Endpoint is idempotent and side-effect-bounded: only instruments without
   * a fresh sample in the last STALE_THRESHOLD_MS (30 min) are reset to 0.
   */
  @Post('refresh-stale')
  @HttpCode(HttpStatus.OK)
  async refreshStale() {
    return this.worker.trigger();
  }
}
