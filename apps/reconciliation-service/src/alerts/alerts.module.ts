import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AlertmanagerIncidentEntity } from '@arbibot/persistence';

import { AlertIncidentsService } from './alert-incidents.service';
import { AlertsController } from './alerts.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AlertmanagerIncidentEntity])],
  controllers: [AlertsController],
  providers: [AlertIncidentsService],
  exports: [AlertIncidentsService],
})
export class AlertsModule {}