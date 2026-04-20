import { Module } from '@nestjs/common';

import { typeOrmRootForEntities } from '@arbibot/nest-database';
import {
  PortfolioPositionEntity,
  PortfolioPositionFillIdempotencyEntity,
  PortfolioPositionCloseIdempotencyEntity,
} from '@arbibot/persistence';

@Module({
  imports: [
    typeOrmRootForEntities([
      PortfolioPositionEntity,
      PortfolioPositionFillIdempotencyEntity,
      PortfolioPositionCloseIdempotencyEntity,
    ]),
  ],
})
export class DatabaseModule {}
