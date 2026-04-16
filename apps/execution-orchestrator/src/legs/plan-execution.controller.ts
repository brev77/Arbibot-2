import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';

import { LegsService } from './legs.service';

@Controller('execution/plans')
export class PlanExecutionController {
  constructor(private readonly legs: LegsService) {}

  @Post(':planId/begin-execution')
  @HttpCode(HttpStatus.OK)
  async begin(
    @Param('planId', new ParseUUIDPipe({ version: '4' })) planId: string,
  ) {
    return this.legs.beginExecution(planId);
  }

  @Get(':planId/legs')
  async list(
    @Param('planId', new ParseUUIDPipe({ version: '4' })) planId: string,
  ) {
    const items = await this.legs.listForPlan(planId);
    return { items };
  }
}
