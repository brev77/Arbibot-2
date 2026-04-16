import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  PortfolioPositionEntity,
  PortfolioPositionFillIdempotencyEntity,
} from '@arbibot/persistence';

import { PositionsController } from './positions.controller';
import { PositionsService } from './positions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PortfolioPositionEntity,
      PortfolioPositionFillIdempotencyEntity,
    ]),
  ],
  controllers: [PositionsController],
  providers: [PositionsService],
})
export class PositionsModule {}
