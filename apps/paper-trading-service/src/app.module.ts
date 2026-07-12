import { Module } from '@nestjs/common';

import { HealthModule } from '@arbibot/nest-platform';

import { DatabaseModule } from './database/database.module';
import { PaperModule } from './paper/paper.module';

@Module({
  imports: [HealthModule, DatabaseModule, PaperModule],
})
export class AppModule {}
