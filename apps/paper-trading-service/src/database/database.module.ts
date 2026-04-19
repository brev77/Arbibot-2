import { Module } from '@nestjs/common';

import { typeOrmRootForEntities } from '@arbibot/nest-database';
import {
  PaperDriftSampleEntity,
  PaperPromotionCandidateEntity,
  PaperTradeEntity,
} from '@arbibot/persistence';

@Module({
  imports: [
    typeOrmRootForEntities([
      PaperTradeEntity,
      PaperPromotionCandidateEntity,
      PaperDriftSampleEntity,
    ]),
  ],
})
export class DatabaseModule {}
