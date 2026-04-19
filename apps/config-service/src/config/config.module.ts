import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PolicyConfigurationEntity } from '@arbibot/persistence';

import { ConfigController } from './config.controller';
import { ConfigurationsService } from './configurations.service';

@Module({
  imports: [TypeOrmModule.forFeature([PolicyConfigurationEntity])],
  controllers: [ConfigController],
  providers: [ConfigurationsService],
})
export class ConfigModule {}
