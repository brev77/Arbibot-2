import { MarketController } from './market.controller';
import { MarketService } from './market.service';

/** MarketController spec (Phase 4 — canonical-market API coverage). */
describe('MarketController', () => {
  let market: { resolveInstrument: jest.Mock; resolveRoute: jest.Mock };
  let controller: MarketController;

  beforeEach(() => {
    market = {
      resolveInstrument: jest.fn(),
      resolveRoute: jest.fn(),
    };
    controller = new MarketController(market as unknown as MarketService);
  });

  it('resolveInstrument forwards the body to MarketService.resolveInstrument', async () => {
    const body = { venueCode: 'BINANCE', venueSymbol: 'BTCUSDT' } as never;
    const out = { canonicalKey: 'BINANCE:BTC-USDT' };
    market.resolveInstrument.mockResolvedValue(out);

    const result = await controller.resolveInstrument(body);

    expect(result).toBe(out);
    expect(market.resolveInstrument).toHaveBeenCalledWith(body);
  });

  it('resolveRoute forwards the body to MarketService.resolveRoute', async () => {
    const body = {
      sourceInstrumentId: 'i1',
      targetInstrumentId: 'i2',
    } as never;
    const out = { routeKey: 'i1->i2' };
    market.resolveRoute.mockResolvedValue(out);

    const result = await controller.resolveRoute(body);

    expect(result).toBe(out);
    expect(market.resolveRoute).toHaveBeenCalledWith(body);
  });

  it('propagates service errors (e.g. NotFoundException) unchanged', async () => {
    const err = new Error('not found');
    market.resolveInstrument.mockRejectedValue(err);

    await expect(controller.resolveInstrument({})).rejects.toBe(err);
  });
});
