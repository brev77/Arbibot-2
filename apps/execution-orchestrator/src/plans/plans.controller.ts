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

import { CreatePlanDto } from './dto/create-plan.dto';
import { LinkReservationDto } from './dto/link-reservation.dto';
import { PlansService } from './plans.service';

function planView(row: Awaited<ReturnType<PlansService['getById']>>) {
  return {
    id: row.id,
    state: row.state,
    correlationId: row.correlationId,
    capitalReservationId: row.capitalReservationId,
    riskDecisionId: row.riskDecisionId,
    entityVersion: row.entityVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Controller('execution/plans')
export class PlansController {
  constructor(private readonly service: PlansService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreatePlanDto) {
    const row = await this.service.create(body);
    return planView(row);
  }

  @Get()
  async list() {
    const items = await this.service.list();
    return { items: items.map((r) => planView(r)) };
  }

  @Get(':id')
  async getOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    const row = await this.service.getById(id);
    return planView(row);
  }

  @Post(':id/link-reservation')
  @HttpCode(HttpStatus.OK)
  async link(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: LinkReservationDto,
  ) {
    const row = await this.service.linkReservation(
      id,
      body.capitalReservationId,
    );
    return planView(row);
  }

  @Post(':id/arm')
  @HttpCode(HttpStatus.OK)
  async arm(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    const row = await this.service.arm(id);
    return planView(row);
  }
}
