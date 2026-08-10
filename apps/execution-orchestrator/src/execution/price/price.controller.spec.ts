import { PriceController } from './price.controller';
import { PriceOracleService } from './price-oracle.service';

/**
 * PriceController spec (PLAN12 #48).
 *
 * Pure delegation to PriceOracleService.getTokenPriceUsd: asserts forwarding of
 * (chainId, tokenAddress), verbatim return of the payload, null-price pass-through
 * (HTTP 200 with `priceUsd: null` — fail-closed contract), and lowercase
 * normalization of the returned tokenAddress.
 */
describe('PriceController', () => {
  let priceOracle: { getTokenPriceUsd: jest.Mock };
  let controller: PriceController;

  beforeEach(() => {
    priceOracle = { getTokenPriceUsd: jest.fn() };
    controller = new PriceController(
      priceOracle as unknown as PriceOracleService,
    );
  });

  it('delegates to PriceOracleService.getTokenPriceUsd with chainId + tokenAddress', async () => {
    priceOracle.getTokenPriceUsd.mockResolvedValue(2600.5);
    const out = await controller.getPrice(42161, '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1');
    expect(priceOracle.getTokenPriceUsd).toHaveBeenCalledWith(
      42161,
      '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    );
    expect(out).toEqual({
      chainId: 42161,
      tokenAddress: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
      priceUsd: 2600.5,
    });
  });

  it('passes null priceUsd through (fail-closed contract)', async () => {
    priceOracle.getTokenPriceUsd.mockResolvedValue(null);
    const out = await controller.getPrice(42161, '0xdeadbeef00000000000000000000000000000000');
    expect(out).toEqual({
      chainId: 42161,
      tokenAddress: '0xdeadbeef00000000000000000000000000000000',
      priceUsd: null,
    });
  });

  it('normalizes a checksummed tokenAddress to lowercase', async () => {
    priceOracle.getTokenPriceUsd.mockResolvedValue(1);
    const out = await controller.getPrice(42161, '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1');
    expect(out.tokenAddress).toBe('0x82af49447d8a07e3bd95bd0d56f35241523fbab1');
  });

  it('forwards a long-tail token (tier-3 resolution handled by the service)', async () => {
    priceOracle.getTokenPriceUsd.mockResolvedValue(0.42);
    const out = await controller.getPrice(42161, '0x539bde0d7dbd336b79148aa742883198bbf60342');
    expect(out.priceUsd).toBe(0.42);
    expect(priceOracle.getTokenPriceUsd).toHaveBeenCalledWith(
      42161,
      '0x539bde0d7dbd336b79148aa742883198bbf60342',
    );
  });
});
