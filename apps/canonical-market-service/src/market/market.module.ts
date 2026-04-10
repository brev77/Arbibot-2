import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CanonicalInstrumentEntity,
  CanonicalRouteEntity,
  VenueRefEntity,
} from '@arbibot/persistence';

import { MarketController } from './market.controller';
import { MarketService } from './market.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      VenueRefEntity,
      CanonicalInstrumentEntity,
      CanonicalRouteEntity,
    ]),
  ],
  controllers: [MarketController],
  providers: [MarketService],
})
export class MarketModule {}
