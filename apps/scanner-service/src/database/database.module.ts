import { Module } from '@nestjs/common';

import { typeOrmRootForEntities } from '@arbibot/nest-database';
import {
  ScannerFindingEntity,
  ScannerInstanceStatusEntity,
} from '@arbibot/persistence';

@Module({
  imports: [
    typeOrmRootForEntities([
      ScannerInstanceStatusEntity,
      ScannerFindingEntity,
    ]),
  ],
})
export class DatabaseModule {}
