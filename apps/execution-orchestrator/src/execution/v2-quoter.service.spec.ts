/* eslint-disable @typescript-eslint/no-explicit-any */
import { V2QuoterService } from './v2-quoter.service';

// Mock `ethers.Contract` so the spec never touches the network.
jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers') as typeof import('ethers');
  const mockGetAmountsOut = jest.fn();
  const MockContract = jest.fn().mockImplementation(() => ({
    getAmountsOut: mockGetAmountsOut,
  }));
  return { ...actual, Contract: MockContract };
});

import { Contract } from 'ethers';

const CHAIN = 42161 as never;
const TOKEN_IN = '0x0000000000000000000000000000000000000001' as never;
const TOKEN_OUT = '0x0000000000000000000000000000000000000002' as never;

function makeProviderManager(): any {
  return { getProvider: jest.fn().mockReturnValue({}) };
}

describe('V2QuoterService', () => {
  let service: V2QuoterService;
  let providerManager: any;
  const mockedContract = Contract as unknown as jest.Mock;
  const getAmountsOutMock = (mockedContract() as any).getAmountsOut;

  beforeEach(() => {
    jest.clearAllMocks();
    providerManager = makeProviderManager();
    service = new V2QuoterService(providerManager);
  });

  it('returns amountOut (bigint) on a successful sushiswap quote', async () => {
    const amountOut = 5_500_000n;
    getAmountsOutMock.mockResolvedValueOnce([1_000_000n, amountOut]);

    const result = await service.quoteExactTokensForTokens(
      CHAIN,
      'sushiswap',
      TOKEN_IN,
      TOKEN_OUT,
      1_000_000n,
    );

    expect(result).toBe(amountOut);
    expect(providerManager.getProvider).toHaveBeenCalledWith(CHAIN);
    expect(getAmountsOutMock).toHaveBeenCalledTimes(1);
    const args = getAmountsOutMock.mock.calls[0]!;
    expect(args[0]).toBe(1_000_000n);
    expect(args[1]).toEqual([TOKEN_IN, TOKEN_OUT]);
  });

  it('routes uniswap-v2 to the Sushi router on Arbitrum (no standalone UniV2 there)', async () => {
    getAmountsOutMock.mockResolvedValueOnce([1_000_000n, 900_000n]);
    const result = await service.quoteExactTokensForTokens(
      CHAIN,
      'uniswap-v2',
      TOKEN_IN,
      TOKEN_OUT,
      1_000_000n,
    );
    expect(result).toBe(900_000n);
  });

  it('returns null on an unsupported venue key', async () => {
    const result = await service.quoteExactTokensForTokens(
      CHAIN,
      'uniswap-v3',
      TOKEN_IN,
      TOKEN_OUT,
      1_000_000n,
    );
    expect(result).toBeNull();
    expect(getAmountsOutMock).not.toHaveBeenCalled();
  });

  it('returns null on a venue not deployed on the chain', async () => {
    // pancakeswap-v2 is BNB-only; on Arbitrum the resolver returns ZERO_ADDRESS.
    const result = await service.quoteExactTokensForTokens(
      CHAIN,
      'pancakeswap-v2',
      TOKEN_IN,
      TOKEN_OUT,
      1_000_000n,
    );
    expect(result).toBeNull();
    expect(providerManager.getProvider).not.toHaveBeenCalled();
  });

  it('returns null when getAmountsOut throws (RPC error / revert)', async () => {
    getAmountsOutMock.mockRejectedValueOnce(new Error('INSUFFICIENT_LIQUIDITY'));
    const result = await service.quoteExactTokensForTokens(
      CHAIN,
      'sushiswap',
      TOKEN_IN,
      TOKEN_OUT,
      1_000_000n,
    );
    expect(result).toBeNull();
  });

  it('returns null when the output is zero (no liquidity)', async () => {
    getAmountsOutMock.mockResolvedValueOnce([1_000_000n, 0n]);
    const result = await service.quoteExactTokensForTokens(
      CHAIN,
      'sushiswap',
      TOKEN_IN,
      TOKEN_OUT,
      1_000_000n,
    );
    expect(result).toBeNull();
  });

  it('never throws — wraps an unexpected provider error to null', async () => {
    providerManager.getProvider = jest.fn().mockImplementation(() => {
      throw new Error('provider boom');
    });
    const result = await service.quoteExactTokensForTokens(
      CHAIN,
      'sushiswap',
      TOKEN_IN,
      TOKEN_OUT,
      1_000_000n,
    );
    expect(result).toBeNull();
  });
});
