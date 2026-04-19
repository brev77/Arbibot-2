import { Module } from '@nestjs/common';

import { DatabaseModule } from './database/database.module';
import { PaperModule } from './paper/paper.module';

@Module({
  imports: [DatabaseModule, PaperModule],
})
export class AppModule {}
