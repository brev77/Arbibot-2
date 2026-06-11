import { Module } from '@nestjs/common';

import { typeOrmRootForEntities } from '@arbibot/nest-database';
import {
  PaperCapitalReservationEntity,
  PaperDiscoveryCandidateEntity,
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
      PaperCapitalReservationEntity,
      PaperDiscoveryCandidateEntity,
    ]),
  ],
})
export class DatabaseModule {}
