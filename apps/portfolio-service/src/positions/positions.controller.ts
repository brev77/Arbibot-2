import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';

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
}
