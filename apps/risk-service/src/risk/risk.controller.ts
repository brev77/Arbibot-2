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

import { EvaluateRiskRequestDto } from './dto/evaluate-risk-request.dto';
import type { EvaluateRiskResponseDto } from './dto/evaluate-risk-response.dto';
import type { RiskDecisionResponseDto } from './dto/risk-decision-response.dto';
import { RiskService } from './risk.service';

@Controller()
export class RiskController {
  constructor(private readonly riskService: RiskService) {}

  @Post('evaluate-risk')
  @HttpCode(HttpStatus.CREATED)
  evaluateRisk(
    @Body() body: EvaluateRiskRequestDto,
  ): EvaluateRiskResponseDto {
    return this.riskService.evaluateRisk(body);
  }

  @Get('risk-decisions/:id')
  getRiskDecision(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): RiskDecisionResponseDto {
    return this.riskService.getRiskDecision(id);
  }
}
