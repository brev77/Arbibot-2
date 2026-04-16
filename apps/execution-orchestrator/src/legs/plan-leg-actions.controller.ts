import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';

import { ApplyFillDto } from './dto/apply-fill.dto';
import { LegsService } from './legs.service';

@Controller('execution/plans/:planId/legs/:legId')
export class PlanLegActionsController {
  constructor(private readonly legs: LegsService) {}

  @Post('mark-sent')
  @HttpCode(HttpStatus.OK)
  async markSent(
    @Param('planId', new ParseUUIDPipe({ version: '4' })) planId: string,
    @Param('legId', new ParseUUIDPipe({ version: '4' })) legId: string,
  ) {
    return this.legs.markSent(planId, legId);
  }

  @Post('mark-acknowledged')
  @HttpCode(HttpStatus.OK)
  async markAck(
    @Param('planId', new ParseUUIDPipe({ version: '4' })) planId: string,
    @Param('legId', new ParseUUIDPipe({ version: '4' })) legId: string,
  ) {
    return this.legs.markAcknowledged(planId, legId);
  }

  @Post('apply-fill')
  @HttpCode(HttpStatus.OK)
  async applyFill(
    @Param('planId', new ParseUUIDPipe({ version: '4' })) planId: string,
    @Param('legId', new ParseUUIDPipe({ version: '4' })) legId: string,
    @Body() body: ApplyFillDto,
  ) {
    return this.legs.applyFill(planId, legId, body);
  }
}
