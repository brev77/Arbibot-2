import { Module } from '@nestjs/common';

import { DatabaseModule } from './database/database.module';
import { MismatchesModule } from './mismatches/mismatches.module';

@Module({
  imports: [DatabaseModule, MismatchesModule],
})
export class AppModule {}
