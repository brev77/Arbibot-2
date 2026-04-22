import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { PolicyModule } from '../policy/policy.module';
import { RiskController } from './risk.controller';
import { RiskService } from './risk.service';

@Module({
  imports: [DatabaseModule, PolicyModule],
  controllers: [RiskController],
  providers: [RiskService],
  exports: [RiskService],
})
export class RiskModule {}
