import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RouteProfileEntity, TokenProfileEntity } from '@arbibot/persistence';

import { PolicyController } from './policy.controller';
import { PolicyProfilesService } from './policy-profiles.service';

@Module({
  imports: [TypeOrmModule.forFeature([TokenProfileEntity, RouteProfileEntity])],
  controllers: [PolicyController],
  providers: [PolicyProfilesService],
})
export class PolicyModule {}
