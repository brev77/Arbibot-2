import { Test } from '@nestjs/testing';
import { Contract, ZeroAddress } from 'ethers';

import { PoolFeeResolverService } from './pool-fee-resolver.service';
import { RpcProviderManager } from '../rpc/rpc-provider-manager.service';

/**
 * PoolFeeResolverService spec (FIX-D, 2026-08-11).
 *
 * `ethers.Contract` is mocked so the resolver reads from a per-call lookup table — no
 * real RPC. We assert: (a) highest-liquidity tier wins, (b) ZeroAddress pools skipped,
 * (c) per-tier errors fall through to the next tier, (d) default 3000 when provider throws,
 * (e) result cached on repeat calls.
 */

// Pool/liquidity scenario: keyed by `poolAddress` → liquidity bigint.
// `getPool(tokenA, tokenB, fee)` → poolAddress (or ZeroAddress when absent).
let poolByFee: Record<number, string>;
let liquidityByPool: Record<string, bigint>;

jest.mock('ethers', () => ({
  Contract: jest.fn((addr: string) => {
    const lower = addr.toLowerCase();
    // V3 factory prefix 0x1f98431...
    if (lower.startsWith('0x1f98431')) {
      return {
        // Mock returns a Promise (to satisfy `await factory.getPool(...)` in the service)
        // without using the `async` keyword — eslint requires `await` inside async arrows.
        getPool: jest.fn((_a: string, _b: string, fee: number) =>
          Promise.resolve(poolByFee[fee] ?? ZeroAddress),
        ),
      };
    }
    return {
      liquidity: jest.fn(() => Promise.resolve(liquidityByPool[lower] ?? 0n)),
    };
  }),
  ZeroAddress: '0x0000000000000000000000000000000000000000',
}));

describe('PoolFeeResolverService', () => {
  let service: PoolFeeResolverService;
  const rpcMock = { getProvider: jest.fn().mockReturnValue({}) };

  beforeEach(async () => {
    poolByFee = {};
    liquidityByPool = {};
    jest.clearAllMocks();
    rpcMock.getProvider.mockReturnValue({});
    const moduleRef = await Test.createTestingModule({
      providers: [
        PoolFeeResolverService,
        { provide: RpcProviderManager, useValue: rpcMock },
      ],
    }).compile();
    service = moduleRef.get(PoolFeeResolverService);
  });

  it('should return the fee tier with the highest liquidity', async () => {
    const A = '0xaaaa000000000000000000000000000000000001';
    const B = '0xbbbb000000000000000000000000000000000002';
    const POOL_500 = '0xc500000000000000000000000000000000000500';
    const POOL_3000 = '0xd300000000000000000000000000000000003000';
    poolByFee = { 500: POOL_500, 3000: POOL_3000 };
    liquidityByPool = {
      [POOL_500]: 9_247_685_727_666_378n, // thin (CRV/WETH fee=500)
      [POOL_3000]: 27_079_522_241_808_212_121_617_30n, // liquid (fee=3000)
    };

    const fee = await service.resolveBestFeeTier(42161, A, B);
    expect(fee).toBe(3000);
  });

  it('should prefer fee=500 when it is the most liquid tier (USDC/WETH case)', async () => {
    const A = '0xaaaa000000000000000000000000000000000001';
    const B = '0xbbbb000000000000000000000000000000000002';
    const POOL_500 = '0xc500000000000000000000000000000000000500';
    const POOL_3000 = '0xd300000000000000000000000000000000003000';
    poolByFee = { 500: POOL_500, 3000: POOL_3000 };
    liquidityByPool = {
      [POOL_500]: 3_641_889_194_724_507_039n, // liquid
      [POOL_3000]: 560_365_064_076_971_742n, // less liquid
    };

    const fee = await service.resolveBestFeeTier(42161, A, B);
    expect(fee).toBe(500);
  });

  it('should skip ZeroAddress pools (tier not deployed)', async () => {
    const A = '0xaaaa000000000000000000000000000000000001';
    const B = '0xbbbb000000000000000000000000000000000002';
    const POOL_3000 = '0xd300000000000000000000000000000000003000';
    // fee=100 and fee=500 absent (ZeroAddress), only fee=3000 exists.
    poolByFee = { 3000: POOL_3000 };
    liquidityByPool = { [POOL_3000]: 10n ** 20n };

    const fee = await service.resolveBestFeeTier(42161, A, B);
    expect(fee).toBe(3000);
  });

  it('should return default 3000 when provider lookup throws', async () => {
    rpcMock.getProvider.mockImplementation(() => {
      throw new Error('no provider');
    });
    const fee = await service.resolveBestFeeTier(
      42161,
      '0xaaaa',
      '0xbbbb',
    );
    expect(fee).toBe(3000);
  });

  it('should return default 3000 for unsupported chain', async () => {
    const fee = await service.resolveBestFeeTier(
      999999,
      '0xaaaa',
      '0xbbbb',
    );
    expect(fee).toBe(3000);
  });

  it('should cache the result (Contract not re-invoked on repeat call)', async () => {
    const A = '0xaaaa000000000000000000000000000000000001';
    const B = '0xbbbb000000000000000000000000000000000002';
    const POOL_3000 = '0xd300000000000000000000000000000000003000';
    poolByFee = { 3000: POOL_3000 };
    liquidityByPool = { [POOL_3000]: 10n ** 20n };

    await service.resolveBestFeeTier(42161, A, B);
    const callsAfterFirst = (Contract as unknown as jest.Mock).mock.calls.length;
    // Mutate the underlying table to return a different pool — cached result must NOT change.
    poolByFee = { 500: '0xee5000000000000000000000000000000000050' };
    liquidityByPool = { '0xee5000000000000000000000000000000000050': 10n ** 22n };
    const fee = await service.resolveBestFeeTier(42161, A, B);
    const callsAfterSecond = (Contract as unknown as jest.Mock).mock.calls.length;
    expect(fee).toBe(3000); // cached, not recomputed
    expect(callsAfterSecond).toBe(callsAfterFirst); // no new Contract calls
  });
});
