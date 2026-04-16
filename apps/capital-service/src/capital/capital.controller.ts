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

import { ReleaseReservationDto } from './dto/release-reservation.dto';
import { ReserveCapitalDto } from './dto/reserve-capital.dto';
import { CapitalService } from './capital.service';

@Controller('capital')
export class CapitalController {
  constructor(private readonly service: CapitalService) {}

  @Post('reservations')
  @HttpCode(HttpStatus.CREATED)
  async reserve(@Body() body: ReserveCapitalDto) {
    const row = await this.service.reserve(body);
    return {
      id: row.id,
      state: row.state,
      correlationId: row.correlationId,
      planId: row.planId,
      amountUsd: row.amountUsd,
      expiresAt: row.expiresAt.toISOString(),
      entityVersion: row.entityVersion,
    };
  }

  @Get('reservations/:id')
  async getOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    const row = await this.service.getById(id);
    return {
      id: row.id,
      state: row.state,
      correlationId: row.correlationId,
      planId: row.planId,
      amountUsd: row.amountUsd,
      expiresAt: row.expiresAt.toISOString(),
      entityVersion: row.entityVersion,
    };
  }

  @Post('reservations/:id/release')
  @HttpCode(HttpStatus.OK)
  async release(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() _body: ReleaseReservationDto,
  ) {
    const row = await this.service.release(id);
    return {
      id: row.id,
      state: row.state,
      correlationId: row.correlationId,
      planId: row.planId,
      amountUsd: row.amountUsd,
      expiresAt: row.expiresAt.toISOString(),
      entityVersion: row.entityVersion,
    };
  }
}
