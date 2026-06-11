import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpStatus,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { IngestMarketSnapshotDto } from './dto/ingest-market-snapshot.dto';
import { GetFreshSnapshotsDto } from './dto/get-fresh-snapshots.dto';
import { SnapshotsService } from './snapshots.service';

@Controller('snapshots')
export class SnapshotsController {
  constructor(private readonly snapshots: SnapshotsService) {}

  /**
   * GET /snapshots/fresh?limit=100
   * Returns fresh (non-stale) snapshots for discovery pipelines.
   * Must be registered BEFORE the generic @Get() to avoid route shadowing.
   */
  @Get('fresh')
  async getFresh(@Query() dto: GetFreshSnapshotsDto) {
    const limit = dto.limit ?? 100;
    return this.snapshots.findFresh(limit);
  }

  @Post('ingest')
  async ingest(
    @Body() body: IngestMarketSnapshotDto,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const result = await this.snapshots.ingest(body);
    if (result.throttled === true) {
      void res.status(HttpStatus.TOO_MANY_REQUESTS);
      return {
        throttled: true,
        reason: result.throttleReason ?? 'throttled',
      };
    }
    if (result.idempotentReplay) {
      void res.header('X-Idempotent-Replayed', 'true');
    }
    return {
      snapshotId: result.snapshotId,
      outboxMessageId: result.outboxMessageId,
      entityVersion: result.entityVersion,
      idempotentReplay: result.idempotentReplay,
      unchanged: result.unchanged,
    };
  }

  @Get()
  get(
    @Query('venueCode') venueCode?: string,
    @Query('venueSymbol') venueSymbol?: string,
  ) {
    const vc = venueCode?.trim();
    const vs = venueSymbol?.trim();
    if (vc === undefined || vc.length === 0 || vs === undefined || vs.length === 0) {
      throw new BadRequestException('venueCode and venueSymbol are required');
    }
    return this.snapshots.getOne(vc, vs);
  }
}
