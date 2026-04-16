import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ReconciliationMismatchEntity } from '@arbibot/persistence';

import { MismatchesController } from './mismatches.controller';
import { MismatchesService } from './mismatches.service';

@Module({
  imports: [TypeOrmModule.forFeature([ReconciliationMismatchEntity])],
  controllers: [MismatchesController],
  providers: [MismatchesService],
})
export class MismatchesModule {}
