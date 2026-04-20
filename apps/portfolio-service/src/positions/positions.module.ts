import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  PortfolioPositionEntity,
  PortfolioPositionFillIdempotencyEntity,
  PortfolioPositionCloseIdempotencyEntity,
} from '@arbibot/persistence';
import { AuditClientService } from '@arbibot/nest-platform';

import { PositionsController } from './positions.controller';
import { PositionsService } from './positions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PortfolioPositionEntity,
      PortfolioPositionFillIdempotencyEntity,
      PortfolioPositionCloseIdempotencyEntity,
    ]),
  ],
  controllers: [PositionsController],
  providers: [PositionsService, AuditClientService],
})
export class PositionsModule {}
