/* eslint-disable @typescript-eslint/no-explicit-any */
// jest.mock is auto-hoisted by jest above imports, so it takes effect before
// `ethers` is imported by the service. `Contract` is replaced with a jest.fn
// we control per-test; other ethers exports stay real.
jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  return {
    ...actual,
    Contract: jest.fn(),
  };
});

import { Test } from '@nestjs/testing';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { Contract } from 'ethers';
import { ChainId, Address, ArbitrumMainnetAddresses, BnbMainnetAddresses } from '@arbibot/contracts-eth';
import { PriceOracleService } from './price-oracle.service';
import { RpcProviderManager } from '../rpc/rpc-provider-manager.service';
import { PoolDiscoveryService } from '../pool/pool-discovery.service';

const MockedContract = Contract as unknown as jest.Mock;

describe('PriceOracleService', () => {
  let service: PriceOracleService;
  let pools: { getCachedPools: jest.Mock };

  beforeEach(async () => {
    getArbibotMetricsRegistry().clear();
    MockedContract.mockReset();
    pools = { getCachedPools: jest.fn().mockReturnValue([]) };

    const module = await Test.createTestingModule({
      providers: [
        PriceOracleService,
        {
          provide: RpcProviderManager,
          useValue: { getProvider: jest.fn().mockReturnValue({}) },
        },
        { provide: PoolDiscoveryService, useValue: pools },
      ],
    }).compile();

    service = module.get(PriceOracleService);
  });

  afterEach(() => {
    service.clearCachesForTest();
  });

  // ── Tier 1: stables → $1 ──────────────────────────────────────────────

  it('returns $1 for USDC (stable, no on-chain read)', async () => {
    const price = await service.getTokenPriceUsd(
      ChainId.ARBITRUM_ONE_MAINNET,
      ArbitrumMainnetAddresses.usdc,
    );
    expect(price).toBe(1);
    expect(MockedContract).not.toHaveBeenCalled();
  });

  it('returns $1 for USDT regardless of casing', async () => {
    const price = await service.getTokenPriceUsd(
      ChainId.ARBITRUM_ONE_MAINNET,
      ArbitrumMainnetAddresses.usdt.toUpperCase() as Address,
    );
    expect(price).toBe(1);
  });

  it('returns $1 for BUSD on BNB Chain', async () => {
    const price = await service.getTokenPriceUsd(
      ChainId.BNB_CHAIN_MAINNET,
      BnbMainnetAddresses.busd,
    );
    expect(price).toBe(1);
  });

  // ── Tier 2: WETH → Chainlink ──────────────────────────────────────────

  it('reads WETH price from Chainlink on Arbitrum', async () => {
    MockedContract.mockImplementation(() => ({
      decimals: jest.fn().mockResolvedValue(8),
      // answer = 2500 * 1e8 = 250000000000
      latestRoundData: jest.fn().mockResolvedValue({
        roundId: 1n,
        answer: 250_000_000_000n,
        startedAt: 1n,
        updatedAt: 1n,
        answeredInRound: 1n,
      }),
    }));

    const price = await service.getTokenPriceUsd(
      ChainId.ARBITRUM_ONE_MAINNET,
      ArbitrumMainnetAddresses.weth,
    );
    expect(price).toBeCloseTo(2500, 1);
  });

  it('reads WBNB price from Chainlink BNB/USD feed', async () => {
    MockedContract.mockImplementation(() => ({
      decimals: jest.fn().mockResolvedValue(8),
      // BNB = 600 USD
      latestRoundData: jest.fn().mockResolvedValue({
        roundId: 1n,
        answer: 60_000_000_000n,
        startedAt: 1n,
        updatedAt: 1n,
        answeredInRound: 1n,
      }),
    }));

    const price = await service.getTokenPriceUsd(
      ChainId.BNB_CHAIN_MAINNET,
      BnbMainnetAddresses.wbnb,
    );
    expect(price).toBeCloseTo(600, 1);
  });

  it('returns null when Chainlink feed is zero-address (testnet)', async () => {
    // Arbitrum Sepolia has zero-address feeds; WETH lookup hits tier 2 → null.
    const price = await service.getTokenPriceUsd(
      ChainId.ARBITRUM_ONE_SEPOLIA,
      '0x4200000000000000000000000000000000000006',
    );
    expect(price).toBeNull();
    // No Contract read attempted when feed is zero-address.
    expect(MockedContract).not.toHaveBeenCalled();
  });

  it('returns null when Chainlink read throws', async () => {
    MockedContract.mockImplementation(() => ({
      decimals: jest.fn().mockRejectedValue(new Error('RPC down')),
      latestRoundData: jest.fn().mockResolvedValue({
        roundId: 1n,
        answer: 1n,
        startedAt: 1n,
        updatedAt: 1n,
        answeredInRound: 1n,
      }),
    }));

    const price = await service.getTokenPriceUsd(
      ChainId.ARBITRUM_ONE_MAINNET,
      ArbitrumMainnetAddresses.weth,
    );
    expect(price).toBeNull();
  });

  // ── Tier 3: arbitrary token → pool reserves ───────────────────────────

  it('prices an arbitrary token via token↔WETH pool reserves', async () => {
    const token = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
    const weth = ArbitrumMainnetAddresses.weth;
    // Pool: 10 WETH and 25000 of the arbitrary token (decimals 6).
    // → tokenPriceInWeth = (10 / 1e18) / (25000 / 1e6) = 0.0004 WETH per token
    // → tokenPriceUsd = 0.0004 * 2500 = 1.0 USD
    pools.getCachedPools.mockReturnValue([
      {
        address: '0xpool' as Address,
        token0: weth,
        token1: token,
        feeBps: 30,
        reserve0: 10n * 10n ** 18n, // 10 WETH
        reserve1: 25_000n * 10n ** 6n, // 25000 tokens
        chainId: ChainId.ARBITRUM_ONE_MAINNET,
        factory: weth,
        protocol: 'uniswap-v2',
        blockNumber: 1,
        discoveredAt: new Date(),
      },
    ]);

    // First call: decimals() for the token; then Chainlink read for WETH price.
    let decimalsCallCount = 0;
    MockedContract.mockImplementation((_addr: string) => ({
      decimals: jest.fn().mockImplementation(() => {
        decimalsCallCount += 1;
        // Token contract called once (6); WETH feed decimals called once (8).
        return Promise.resolve(decimalsCallCount === 1 ? 6 : 8);
      }),
      latestRoundData: jest.fn().mockResolvedValue({
        roundId: 1n,
        answer: 250_000_000_000n, // ETH = 2500 USD
        startedAt: 1n,
        updatedAt: 1n,
        answeredInRound: 1n,
      }),
    }));

    const price = await service.getTokenPriceUsd(ChainId.ARBITRUM_ONE_MAINNET, token);
    expect(price).not.toBeNull();
    expect(price).toBeCloseTo(1.0, 3);
  });

  it('returns null when no token↔WETH pool is cached', async () => {
    pools.getCachedPools.mockReturnValue([]);
    const price = await service.getTokenPriceUsd(
      ChainId.ARBITRUM_ONE_MAINNET,
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    );
    expect(price).toBeNull();
  });

  it('skips V3 pools for pricing (reserves unreliable)', async () => {
    const token = '0xcccccccccccccccccccccccccccccccccccccccc' as Address;
    pools.getCachedPools.mockReturnValue([
      {
        address: '0xpool' as Address,
        token0: ArbitrumMainnetAddresses.weth,
        token1: token,
        feeBps: 500,
        reserve0: 1n,
        reserve1: 1n,
        chainId: ChainId.ARBITRUM_ONE_MAINNET,
        factory: ArbitrumMainnetAddresses.weth,
        protocol: 'uniswap-v3',
        blockNumber: 1,
        discoveredAt: new Date(),
      },
    ]);
    const price = await service.getTokenPriceUsd(ChainId.ARBITRUM_ONE_MAINNET, token);
    expect(price).toBeNull();
  });

  it('returns null when pool reserves are zero', async () => {
    const token = '0xdddddddddddddddddddddddddddddddddddddddd' as Address;
    pools.getCachedPools.mockReturnValue([
      {
        address: '0xpool' as Address,
        token0: ArbitrumMainnetAddresses.weth,
        token1: token,
        feeBps: 30,
        reserve0: 0n,
        reserve1: 0n,
        chainId: ChainId.ARBITRUM_ONE_MAINNET,
        factory: ArbitrumMainnetAddresses.weth,
        protocol: 'uniswap-v2',
        blockNumber: 1,
        discoveredAt: new Date(),
      },
    ]);
    const price = await service.getTokenPriceUsd(ChainId.ARBITRUM_ONE_MAINNET, token);
    expect(price).toBeNull();
  });

  // ── Decimals cache ────────────────────────────────────────────────────

  it('caches token decimals (single read across lookups)', async () => {
    const token = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as Address;
    pools.getCachedPools.mockReturnValue([
      {
        address: '0xpool' as Address,
        token0: ArbitrumMainnetAddresses.weth,
        token1: token,
        feeBps: 30,
        reserve0: 10n * 10n ** 18n,
        reserve1: 25_000n * 10n ** 6n,
        chainId: ChainId.ARBITRUM_ONE_MAINNET,
        factory: ArbitrumMainnetAddresses.weth,
        protocol: 'uniswap-v2',
        blockNumber: 1,
        discoveredAt: new Date(),
      },
    ]);

    const decimalsMock = jest.fn().mockResolvedValue(6);
    MockedContract.mockImplementation(() => ({
      decimals: decimalsMock,
      latestRoundData: jest.fn().mockResolvedValue({
        roundId: 1n,
        answer: 250_000_000_000n,
        startedAt: 1n,
        updatedAt: 1n,
        answeredInRound: 1n,
      }),
    }));

    // First lookup resolves the price and caches it.
    await service.getTokenPriceUsd(ChainId.ARBITRUM_ONE_MAINNET, token);
    const callsAfterFirst = decimalsMock.mock.calls.length;

    // Within TTL the entire price is cached — no second decimals read.
    await service.getTokenPriceUsd(ChainId.ARBITRUM_ONE_MAINNET, token);
    expect(decimalsMock.mock.calls.length).toBe(callsAfterFirst);
  });

  // ── Price cache + single-flight ───────────────────────────────────────

  it('serves cached price on second call within TTL (no repeat Chainlink read)', async () => {
    const latestRoundData = jest.fn().mockResolvedValue({
      roundId: 1n,
      answer: 250_000_000_000n,
      startedAt: 1n,
      updatedAt: 1n,
      answeredInRound: 1n,
    });
    MockedContract.mockImplementation(() => ({
      decimals: jest.fn().mockResolvedValue(8),
      latestRoundData,
    }));

    await service.getTokenPriceUsd(ChainId.ARBITRUM_ONE_MAINNET, ArbitrumMainnetAddresses.weth);
    await service.getTokenPriceUsd(ChainId.ARBITRUM_ONE_MAINNET, ArbitrumMainnetAddresses.weth);
    await service.getTokenPriceUsd(ChainId.ARBITRUM_ONE_MAINNET, ArbitrumMainnetAddresses.weth);

    // latestRoundData invoked once; subsequent calls hit cache.
    expect(latestRoundData).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent lookups for the same token (single-flight)', async () => {
    let resolveLatest: (v: any) => void = () => undefined;
    const latestRoundData = jest.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLatest = resolve;
        }),
    );
    MockedContract.mockImplementation(() => ({
      decimals: jest.fn().mockResolvedValue(8),
      latestRoundData,
    }));

    // Fire two concurrent lookups before the first resolves.
    const p1 = service.getTokenPriceUsd(ChainId.ARBITRUM_ONE_MAINNET, ArbitrumMainnetAddresses.weth);
    const p2 = service.getTokenPriceUsd(ChainId.ARBITRUM_ONE_MAINNET, ArbitrumMainnetAddresses.weth);

    // Only one Chainlink call should be in flight.
    expect(latestRoundData).toHaveBeenCalledTimes(1);

    resolveLatest({
      roundId: 1n,
      answer: 250_000_000_000n,
      startedAt: 1n,
      updatedAt: 1n,
      answeredInRound: 1n,
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBeCloseTo(2500, 1);
    expect(r2).toBeCloseTo(2500, 1);
  });

  // ── Fail-state ────────────────────────────────────────────────────────

  it('returns null for unsupported chain', async () => {
    const price = await service.getTokenPriceUsd(
      999999 as ChainId,
      '0xffffffffffffffffffffffffffffffffffffffff',
    );
    expect(price).toBeNull();
  });
});
