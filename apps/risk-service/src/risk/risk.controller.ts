import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { EvaluateRiskRequestDto } from './dto/evaluate-risk-request.dto';
import type { EvaluateRiskResponseDto } from './dto/evaluate-risk-response.dto';
import { ReserveRiskWindowRequestDto } from './dto/reserve-risk-window-request.dto';
import type { ReserveRiskWindowResponseDto } from './dto/reserve-risk-window-response.dto';
import type { RiskDecisionResponseDto } from './dto/risk-decision-response.dto';
import { RiskService } from './risk.service';

@Controller()
export class RiskController {
  constructor(private readonly riskService: RiskService) {}

  @Post('reserve-risk-window')
  @HttpCode(HttpStatus.CREATED)
  async reserveRiskWindow(
    @Body() body: ReserveRiskWindowRequestDto,
  ): Promise<ReserveRiskWindowResponseDto> {
    return this.riskService.reserveRiskWindow(body);
  }

  @Post('evaluate-risk')
  async evaluateRisk(
    @Body() body: EvaluateRiskRequestDto,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<EvaluateRiskResponseDto> {
    const { response, replay } = await this.riskService.evaluateRisk(body);
    res.status(replay ? HttpStatus.OK : HttpStatus.CREATED);
    if (replay) {
      void res.header('X-Idempotent-Replayed', 'true');
    }
    return response;
  }

  @Get('risk-decisions/:id')
  async getRiskDecision(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<RiskDecisionResponseDto> {
    return this.riskService.getRiskDecision(id);
  }
}
