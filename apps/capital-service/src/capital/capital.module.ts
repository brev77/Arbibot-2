import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CapitalReservationEntity, PortfolioPositionEntity } from '@arbibot/persistence';

import { CapitalController } from './capital.controller';
import { CapitalService } from './capital.service';
import { CapitalLimitsService } from './capital-limits.service';

@Module({
  // PortfolioPositionEntity is registered so capital-service can read
  // portfolio_positions (read-only SUM for the aggregate ceiling). The
  // single-writer for that table remains portfolio-service.
  imports: [TypeOrmModule.forFeature([CapitalReservationEntity, PortfolioPositionEntity])],
  controllers: [CapitalController],
  providers: [CapitalService, CapitalLimitsService],
})
export class CapitalModule {}
