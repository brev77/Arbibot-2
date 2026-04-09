import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CapitalReservationEntity } from '@arbibot/persistence';

import { CapitalController } from './capital.controller';
import { CapitalService } from './capital.service';

@Module({
  imports: [TypeOrmModule.forFeature([CapitalReservationEntity])],
  controllers: [CapitalController],
  providers: [CapitalService],
})
export class CapitalModule {}
