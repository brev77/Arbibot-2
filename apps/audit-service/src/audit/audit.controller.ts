import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { AppendAuditDto } from './dto/append-audit.dto';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Post('entries')
  async append(
    @Body() body: AppendAuditDto,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const { replay, entity } = await this.service.append(body);
    res.status(replay ? HttpStatus.OK : HttpStatus.CREATED);
    if (replay) {
      void res.header('X-Idempotent-Replayed', 'true');
    }
    return {
      id: entity.id,
      correlationId: entity.correlationId,
      actor: entity.actor,
      action: entity.action,
      createdAt: entity.createdAt.toISOString(),
    };
  }

  @Get('entries')
  async list(@Query('limit') limitRaw?: string) {
    const limit = limitRaw !== undefined ? Number(limitRaw) : 50;
    const items = await this.service.recent(
      Number.isFinite(limit) ? limit : 50,
    );
    return {
      items: items.map((row) => ({
        id: row.id,
        correlationId: row.correlationId,
        actor: row.actor,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        payload: row.payload,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }
}
