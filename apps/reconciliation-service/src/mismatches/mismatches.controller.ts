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
} from '@nestjs/common';

import { UpdateMismatchStatusDto } from './dto/update-mismatch-status.dto';
import { MismatchesService } from './mismatches.service';

function rowView(row: Awaited<ReturnType<MismatchesService['list']>>[number]) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    details: row.details,
    entityVersion: row.entityVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Controller()
export class MismatchesController {
  constructor(private readonly service: MismatchesService) {}

  @Get('mismatches')
  async list() {
    const rows = await this.service.list();
    return { items: rows.map((r) => rowView(r)) };
  }

  /** Operator / internal: scan OLTP tables and append reconciliation rows. */
  @Post('mismatches/run-detectors')
  async runDetectors() {
    return this.service.runDetectors();
  }

  @Patch('mismatches/:id')
  @HttpCode(HttpStatus.OK)
  async patchStatus(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdateMismatchStatusDto,
  ) {
    const row = await this.service.updateStatus(id, body);
    return rowView(row);
  }
}
