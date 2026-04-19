import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { PaperPromotionService } from './paper-promotion.service';
import { CreatePromotionCandidateDto } from './dto/create-promotion-candidate.dto';
import { PatchPromotionCandidateDto } from './dto/patch-promotion-candidate.dto';

function promoView(row: Awaited<ReturnType<PaperPromotionService['list']>>[number]) {
  return {
    id: row.id,
    instrumentKey: row.instrumentKey,
    opportunityId: row.opportunityId,
    source: row.source,
    status: row.status,
    score: row.score,
    driftBps: row.driftBps,
    evidence: row.evidence,
    enqueueIdempotencyKey: row.enqueueIdempotencyKey,
    entityVersion: row.entityVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Controller('paper/promotion-candidates')
export class PaperPromotionController {
  constructor(private readonly service: PaperPromotionService) {}

  @Get()
  async list(@Query('status') status?: string) {
    const rows = await this.service.list(status);
    return { items: rows.map((r) => promoView(r)) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreatePromotionCandidateDto) {
    const row = await this.service.create(body);
    return promoView(row);
  }

  @Patch(':id')
  async patch(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: PatchPromotionCandidateDto,
  ) {
    const row = await this.service.patch(id, body);
    return promoView(row);
  }
}
