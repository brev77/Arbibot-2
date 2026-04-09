import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';

import { CreateOpportunityDto } from './dto/create-opportunity.dto';
import { OpportunitiesService } from './opportunities.service';

@Controller('opportunities')
export class OpportunitiesController {
  constructor(private readonly service: OpportunitiesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreateOpportunityDto) {
    const row = await this.service.create(body);
    return {
      id: row.id,
      state: row.state,
      correlationId: row.correlationId,
      entityVersion: row.entityVersion,
      createdAt: row.createdAt.toISOString(),
    };
  }

  @Get()
  async list() {
    const items = await this.service.list();
    return {
      items: items.map((row) => ({
        id: row.id,
        state: row.state,
        correlationId: row.correlationId,
        entityVersion: row.entityVersion,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  @Get(':id')
  async getOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    const row = await this.service.getById(id);
    if (row === null) {
      throw new NotFoundException(`Opportunity not found: ${id}`);
    }
    return {
      id: row.id,
      state: row.state,
      correlationId: row.correlationId,
      payload: row.payload,
      entityVersion: row.entityVersion,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
