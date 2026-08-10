import { ensureWrappedNativeBalance } from './native-wrap';

/**
 * native-wrap spec (PLAN13 #51).
 *
 * Covers: no-op when tokenIn is not the wrapped native; no-op when the wallet already has
 * sufficient WETH; wraps the shortfall via WETH.deposit when balance is below amountIn.
 * The WETH9 contract and ethers Wallet are hand-rolled mocks — no RPC calls.
 */
const ARB_WETH = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1';
const ARB_CHAIN = 42161;

function makeWallet(balanceReturn: bigint, sendTxImpl?: (req: unknown) => Promise<unknown>) {
  // Hand-rolled Wallet mock: sendTransaction + a provider-like Contract call surface.
  // `ensureWrappedNativeBalance` constructs its own `Contract(weth, abi, wallet.wallet)`,
  // so we stub the wallet.wallet.sendTransaction and rely on jest.mock('ethers') below for
  // the Contract balanceOf path.
  return {
    address: '0xdea3e1e8cf92349cab0b46095ae03732afb646f3',
    wallet: {
      address: '0xdea3e1e8cf92349cab0b46095ae03732afb646f3',
      sendTransaction: sendTxImpl ?? jest.fn(),
    },
  } as never;
}

// Mock ethers.Contract so `balanceOf` returns a controlled value and `deposit` is observable.
jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  let mockBalance = 0n;
  let depositCalls: bigint[] = [];
  return {
    ...actual,
    Contract: class MockContract {
      constructor(
        _address: string,
        _abi: unknown,
        _runner: unknown,
      ) {}
      static setMockBalance(b: bigint) {
        mockBalance = b;
      }
      static getDepositCalls() {
        return depositCalls;
      }
      static reset() {
        mockBalance = 0n;
        depositCalls = [];
      }
      async balanceOf() {
        return Promise.resolve(mockBalance);
      }
    },
  };
});

// Re-import after jest.mock so the mocked Contract is in scope.
import { Contract } from 'ethers';

describe('ensureWrappedNativeBalance', () => {
  beforeEach(() => {
    (Contract as unknown as { reset: () => void }).reset();
  });

  it('is a no-op when tokenIn is not the wrapped native (e.g. USDC)', async () => {
    const sendTx = jest.fn();
    const wallet = makeWallet(0n, sendTx);
    // USDC address — not WETH
    await ensureWrappedNativeBalance({
      chainId: ARB_CHAIN,
      tokenIn: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
      amountIn: '10000000',
      wallet,
    });
    expect(sendTx).not.toHaveBeenCalled();
  });

  it('is a no-op when the wallet already has sufficient WETH', async () => {
    (Contract as unknown as { setMockBalance: (b: bigint) => void }).setMockBalance(10n ** 18n);
    const sendTx = jest.fn();
    const wallet = makeWallet(10n ** 18n, sendTx);
    // amountIn = 0.005 WETH (5 × 10^15), balance = 1 WETH (10^18) → sufficient
    await ensureWrappedNativeBalance({
      chainId: ARB_CHAIN,
      tokenIn: ARB_WETH,
      amountIn: '5000000000000000',
      wallet,
    });
    expect(sendTx).not.toHaveBeenCalled();
  });

  it('wraps the shortfall via WETH.deposit when balance is below amountIn', async () => {
    // balance = 0, amountIn = 0.005 WETH → shortfall = 0.005 × 10^18 = 5 × 10^15
    (Contract as unknown as { setMockBalance: (b: bigint) => void }).setMockBalance(0n);
    const sendTx = jest.fn().mockResolvedValue({
      wait: jest.fn().mockResolvedValue({ status: 1, hash: '0xwrap123' }),
    });
    const wallet = makeWallet(0n, sendTx);
    await ensureWrappedNativeBalance({
      chainId: ARB_CHAIN,
      tokenIn: ARB_WETH,
      amountIn: '5000000000000000',
      wallet,
    });
    expect(sendTx).toHaveBeenCalledTimes(1);
    const txReq = sendTx.mock.calls[0]![0] as { to: string; value: bigint; data: string };
    expect(txReq.to.toLowerCase()).toBe(ARB_WETH);
    expect(txReq.data).toBe('0xd0e30db0'); // deposit() selector
    expect(txReq.value).toBe(5_000_000_000_000_000n); // shortfall
  });

  it('wraps only the shortfall, not the full amountIn (partial balance)', async () => {
    // balance = 0.002 WETH (2 × 10^15), amountIn = 0.005 WETH → shortfall = 0.003 × 10^18
    (Contract as unknown as { setMockBalance: (b: bigint) => void }).setMockBalance(2_000_000_000_000_000n);
    const sendTx = jest.fn().mockResolvedValue({
      wait: jest.fn().mockResolvedValue({ status: 1, hash: '0xwrap456' }),
    });
    const wallet = makeWallet(2_000_000_000_000_000n, sendTx);
    await ensureWrappedNativeBalance({
      chainId: ARB_CHAIN,
      tokenIn: ARB_WETH,
      amountIn: '5000000000000000',
      wallet,
    });
    expect(sendTx).toHaveBeenCalledTimes(1);
    const txReq = sendTx.mock.calls[0]![0] as { value: bigint };
    expect(txReq.value).toBe(3_000_000_000_000_000n); // 0.005 - 0.002 = 0.003
  });

  it('throws when the deposit tx reverts (status=0)', async () => {
    (Contract as unknown as { setMockBalance: (b: bigint) => void }).setMockBalance(0n);
    const sendTx = jest.fn().mockResolvedValue({
      wait: jest.fn().mockResolvedValue({ status: 0, hash: '0xwrap789' }),
    });
    const wallet = makeWallet(0n, sendTx);
    await expect(
      ensureWrappedNativeBalance({
        chainId: ARB_CHAIN,
        tokenIn: ARB_WETH,
        amountIn: '5000000000000000',
        wallet,
      }),
    ).rejects.toThrow(/native wrap failed/);
  });
});
