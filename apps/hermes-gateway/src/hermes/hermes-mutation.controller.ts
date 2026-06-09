import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { HermesAuthGuard } from './hermes-auth.guard';
import {
  HermesOperatorMutationDto,
  ResolveIncidentMutationDto,
} from './dto/operator-mutation.dto';
import { SafeModeMutationDto } from './dto/safe-mode.dto';
import { HermesMutationRateLimitGuard } from './hermes-mutation-rate-limit.guard';
import { HermesMutationService } from './hermes-mutation.service';

type ReqWithCorr = { correlationId?: string };

function getCorrelationId(req: ReqWithCorr): string | undefined {
  return typeof req.correlationId === 'string' && req.correlationId.length > 0
    ? req.correlationId
    : undefined;
}

@Controller('hermes/v1')
@UseGuards(HermesAuthGuard, HermesMutationRateLimitGuard)
export class HermesMutationController {
  constructor(private readonly mutations: HermesMutationService) {}

  @Post('plans/:id/arm')
  @HttpCode(HttpStatus.OK)
  async armPlan(
    @Req() req: ReqWithCorr,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: HermesOperatorMutationDto,
  ): Promise<unknown> {
    return this.mutations.armPlan(id, body, getCorrelationId(req));
  }

  /** Executes `begin-execution` on the orchestrator (operator naming: "execute"). */
  @Post('plans/:id/execute')
  @HttpCode(HttpStatus.OK)
  async executePlan(
    @Req() req: ReqWithCorr,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: HermesOperatorMutationDto,
  ): Promise<unknown> {
    return this.mutations.beginExecution(id, body, getCorrelationId(req));
  }

  @Post('positions/:id/close')
  @HttpCode(HttpStatus.OK)
  async closePosition(
    @Req() req: ReqWithCorr,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: HermesOperatorMutationDto,
  ): Promise<unknown> {
    return this.mutations.closePosition(id, body, getCorrelationId(req));
  }

  @Post('incidents/:id/resolve')
  @HttpCode(HttpStatus.OK)
  async resolveIncident(
    @Req() req: ReqWithCorr,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: ResolveIncidentMutationDto,
  ): Promise<unknown> {
    return this.mutations.resolveIncident(id, body, getCorrelationId(req));
  }

  @Post('safe-mode/enable')
  @HttpCode(HttpStatus.OK)
  async safeModeEnable(
    @Req() req: ReqWithCorr,
    @Body() body: SafeModeMutationDto,
  ): Promise<unknown> {
    return this.mutations.enableSafeMode(body, getCorrelationId(req));
  }

  @Post('safe-mode/disable')
  @HttpCode(HttpStatus.OK)
  async safeModeDisable(
    @Req() req: ReqWithCorr,
    @Body() body: SafeModeMutationDto,
  ): Promise<unknown> {
    return this.mutations.disableSafeMode(body, getCorrelationId(req));
  }
}
