import { Module } from '@nestjs/common';

import { typeOrmRootForEntities } from '@arbibot/nest-database';
import {
  CanonicalInstrumentEntity,
  CanonicalRouteEntity,
  VenueRefEntity,
} from '@arbibot/persistence';

@Module({
  imports: [
    typeOrmRootForEntities([
      VenueRefEntity,
      CanonicalInstrumentEntity,
      CanonicalRouteEntity,
    ]),
  ],
})
export class DatabaseModule {}
