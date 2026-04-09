import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { EvaluateRiskRequestDto } from './dto/evaluate-risk-request.dto';
import type { EvaluateRiskResponseDto } from './dto/evaluate-risk-response.dto';
import type { RiskDecisionResponseDto } from './dto/risk-decision-response.dto';
import { RiskService } from './risk.service';

@Controller()
export class RiskController {
  constructor(private readonly riskService: RiskService) {}

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
