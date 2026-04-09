import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OutboxEventEntity, RiskDecisionEntity } from '@arbibot/persistence';

import { RiskController } from './risk.controller';
import { RiskService } from './risk.service';

@Module({
  imports: [TypeOrmModule.forFeature([RiskDecisionEntity, OutboxEventEntity])],
  controllers: [RiskController],
  providers: [RiskService],
  exports: [RiskService],
})
export class RiskModule {}
