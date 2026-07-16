import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PolicyConfigurationEntity } from '@arbibot/persistence';

import { ConfigController } from './config.controller';
import { ConfigurationsService } from './configurations.service';
import { PanicController } from './panic.controller';
import { PanicService } from './panic.service';

@Module({
  imports: [TypeOrmModule.forFeature([PolicyConfigurationEntity])],
  controllers: [ConfigController, PanicController],
  providers: [ConfigurationsService, PanicService],
})
export class ConfigModule {}
