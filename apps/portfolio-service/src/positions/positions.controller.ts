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

import { ClosePositionDto } from './dto/close-position.dto';
import { ConfirmFillDto } from './dto/confirm-fill.dto';
import { PositionsService } from './positions.service';

function rowView(row: Awaited<ReturnType<PositionsService['list']>>[number]) {
  return {
    id: row.id,
    planId: row.planId,
    instrumentKey: row.instrumentKey,
    quantity: row.quantity,
    entityVersion: row.entityVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Controller()
export class PositionsController {
  constructor(private readonly service: PositionsService) {}

  @Get('positions')
  async list() {
    const rows = await this.service.list();
    return { items: rows.map((r) => rowView(r)) };
  }

  @Post('positions/confirm-fill')
  @HttpCode(HttpStatus.NO_CONTENT)
  async confirmFill(@Body() body: ConfirmFillDto) {
    await this.service.confirmFill(body);
  }

  /** Operator-initiated close (quantity → 0). Used by HERMES and manual flows. */
  @Post('positions/:id/close')
  @HttpCode(HttpStatus.OK)
  async close(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: ClosePositionDto,
  ) {
    const row = await this.service.close(id, body);
    return rowView(row);
  }
}
