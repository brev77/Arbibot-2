import { Module } from '@nestjs/common';

import { typeOrmRootForEntities } from '@arbibot/nest-database';
import {
  PortfolioPositionEntity,
  PortfolioPositionFillIdempotencyEntity,
} from '@arbibot/persistence';

@Module({
  imports: [
    typeOrmRootForEntities([
      PortfolioPositionEntity,
      PortfolioPositionFillIdempotencyEntity,
    ]),
  ],
})
export class DatabaseModule {}
