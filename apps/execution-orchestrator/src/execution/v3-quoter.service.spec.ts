/* eslint-disable @typescript-eslint/no-explicit-any */
import { V3QuoterService } from './v3-quoter.service';

// Mock `ethers.Contract` so the spec never touches the network. The contract
// constructor is replaced with a factory returning an object whose
// `quoteExactInputSingle.staticCall` resolves to a configured tuple.
jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  const mockStaticCall = jest.fn();
  const MockContract = jest.fn().mockImplementation(() => ({
    quoteExactInputSingle: {
      staticCall: mockStaticCall,
    },
  }));
  return { ...actual, Contract: MockContract };
});

// Re-import after the module mock is registered so `Contract` is the mock.
import { Contract } from 'ethers';

const CHAIN = 42161 as never;
const TOKEN_IN = '0x0000000000000000000000000000000000000001' as never;
const TOKEN_OUT = '0x0000000000000000000000000000000000000002' as never;
const UNSUPPORTED_CHAIN = 999 as never;

function makeProviderManager(): any {
  return { getProvider: jest.fn().mockReturnValue({}) };
}

describe('V3QuoterService', () => {
  let service: V3QuoterService;
  let providerManager: any;
  const mockedContract = Contract as unknown as jest.Mock;
  // The staticCall mock is the same reference captured in the factory above.
  const staticCallMock = (mockedContract() as any).quoteExactInputSingle.staticCall;

  beforeEach(() => {
    jest.clearAllMocks();
    providerManager = makeProviderManager();
    service = new V3QuoterService(providerManager);
  });

  it('returns amountOut (bigint) on a successful mainnet quote', async () => {
    const amountOut = 37_566_526_995_818_509_031n;
    staticCallMock.mockResolvedValueOnce([amountOut, 0n, 0, 0n]);

    const result = await service.quoteExactInputSingle(
      CHAIN,
      TOKEN_IN,
      TOKEN_OUT,
      5_299_459_727_694_495n,
      3000,
    );

    expect(result).toBe(amountOut);
    expect(providerManager.getProvider).toHaveBeenCalledWith(CHAIN);
    // FIX-B idiom: must route through `.staticCall`, never a direct call.
    expect(staticCallMock).toHaveBeenCalledTimes(1);
    const arg = staticCallMock.mock.calls[0]![0];
    expect(arg.tokenIn).toBe(TOKEN_IN);
    expect(arg.tokenOut).toBe(TOKEN_OUT);
    expect(arg.fee).toBe(3000);
    expect(arg.sqrtPriceLimitX96).toBe(0n);
  });

  it('returns null on an unsupported chain (no QuoterV2 deployed)', async () => {
    const result = await service.quoteExactInputSingle(
      UNSUPPORTED_CHAIN,
      TOKEN_IN,
      TOKEN_OUT,
      1_000_000n,
      3000,
    );
    expect(result).toBeNull();
    // No provider access attempted when the address resolves to ZERO_ADDRESS.
    expect(providerManager.getProvider).not.toHaveBeenCalled();
    expect(staticCallMock).not.toHaveBeenCalled();
  });

  it('returns null when the quote throws (RPC error / revert)', async () => {
    staticCallMock.mockRejectedValueOnce(new Error('execution reverted'));
    const result = await service.quoteExactInputSingle(
      CHAIN,
      TOKEN_IN,
      TOKEN_OUT,
      1_000_000n,
      3000,
    );
    expect(result).toBeNull();
  });

  it('returns null when amountOut is zero (pool not initialized / bad path)', async () => {
    staticCallMock.mockResolvedValueOnce([0n, 0n, 0, 0n]);
    const result = await service.quoteExactInputSingle(
      CHAIN,
      TOKEN_IN,
      TOKEN_OUT,
      1_000_000n,
      3000,
    );
    expect(result).toBeNull();
  });

  it('never throws — wraps any unexpected provider error to null', async () => {
    providerManager.getProvider = jest.fn().mockImplementation(() => {
      throw new Error('provider boom');
    });
    const result = await service.quoteExactInputSingle(
      CHAIN,
      TOKEN_IN,
      TOKEN_OUT,
      1_000_000n,
      3000,
    );
    expect(result).toBeNull();
  });
});
