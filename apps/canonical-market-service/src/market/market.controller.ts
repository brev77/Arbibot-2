import { Body, Controller, Post } from '@nestjs/common';

import { ResolveInstrumentDto } from './dto/resolve-instrument.dto';
import { ResolveRouteDto } from './dto/resolve-route.dto';
import { MarketService } from './market.service';

@Controller('market')
export class MarketController {
  constructor(private readonly market: MarketService) {}

  @Post('resolve-instrument')
  resolveInstrument(@Body() body: ResolveInstrumentDto) {
    return this.market.resolveInstrument(body);
  }

  @Post('resolve-route')
  resolveRoute(@Body() body: ResolveRouteDto) {
    return this.market.resolveRoute(body);
  }
}
