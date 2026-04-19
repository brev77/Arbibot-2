import { Controller, Get } from '@nestjs/common';

import { PaperPromotionService } from './paper-promotion.service';

@Controller('paper')
export class PaperPromotionCriteriaController {
  constructor(private readonly promotion: PaperPromotionService) {}

  @Get('promotion-criteria')
  getCriteria() {
    return this.promotion.getPromotionCriteria();
  }
}
