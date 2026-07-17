// jest.mock is auto-hoisted by jest above imports, so it takes effect before
// `ethers` is imported by the service. `Contract` is replaced with a jest.fn
// we control per-test; other ethers exports stay real. (Same pattern as
// price-oracle.service.spec.ts — Phase 2 ContractFactory is not required for
// coverage; the jest.mock shim is sufficient and avoids refactoring 3 call
// sites in the production code.)
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

import { ChainId } from '@arbibot/contracts-eth';

import { TokenApproveService } from './token-approve.service';
import { WalletManagerService } from '../wallet-manager.service';
import { RpcProviderManager } from '../rpc/rpc-provider-manager.service';

const MockedContract = Contract as unknown as jest.Mock;

/**
 * TokenApproveService spec (DEX-1-1-APPROVE-PATTERN, risk tracker H4).
 *
 * ERC-20 approve/revoke is capital-critical — an unchecked allowance or a
 * mis-built approve tx directly loses funds. This spec exercises the safe
 * approval state machine (revoke-to-zero before setting a new amount) and the
 * confirmation/receipt handling, with ethers `Contract` mocked out so no chain
 * I/O occurs. Pattern B (Nest TestingModule) + jest.mock('ethers').
 */
describe('TokenApproveService', () => {
  let service: TokenApproveService;
  let walletManager: { selectWallet: jest.Mock };
  let rpcProviderManager: { getProvider: jest.Mock };

  const CHAIN = ChainId.ARBITRUM_ONE_MAINNET;
  const TOKEN = '0xToken' as never;
  const SPENDER = '0xSpender' as never;
  const WALLET_ADDRESS = '0xWallet' as never;
  const WALLET = { address: WALLET_ADDRESS } as never;

  /** Build a fake write-side ERC20 contract (approve). */
  const writeContract = (
    approveImpl: (spender: string, amount: bigint) => Promise<unknown>,
  ) => ({
    approve: jest.fn(approveImpl),
  });

  /** Build a fake read-side ERC20 contract (allowance). */
  const readContract = (allowanceValue: bigint) => ({
    allowance: jest.fn().mockResolvedValue(allowanceValue),
  });

  /** A tx + 1-block receipt with the given status (1 = success). */
  const txWithReceipt = (status: number, gasUsed = 21000n) => ({
    hash: '0xtxhash',
    wait: jest.fn().mockResolvedValue({ status, gasUsed }),
  });

  beforeEach(async () => {
    getArbibotMetricsRegistry().clear();
    MockedContract.mockReset();

    walletManager = {
      selectWallet: jest.fn().mockResolvedValue({
        keyId: 'k1',
        address: WALLET_ADDRESS,
        chainId: CHAIN,
        wallet: WALLET,
      }),
    };
    rpcProviderManager = { getProvider: jest.fn().mockReturnValue({}) };

    const module = await Test.createTestingModule({
      providers: [
        TokenApproveService,
        { provide: WalletManagerService, useValue: walletManager },
        { provide: RpcProviderManager, useValue: rpcProviderManager },
      ],
    }).compile();

    service = module.get(TokenApproveService);
  });

  describe('approveToken', () => {
    it('approves when current allowance is 0 (no revoke-first), returns confirmed result', async () => {
      // getAllowance read (first Contract call) returns 0; approve write (second
      // Contract call) returns a tx confirmed with status=1.
      MockedContract
        .mockImplementationOnce(() => readContract(0n)) // allowance read
        .mockImplementationOnce(() => writeContract(() => Promise.resolve(txWithReceipt(1))));

      const result = await service.approveToken({
        chainId: CHAIN,
        tokenAddress: TOKEN,
        spender: SPENDER,
        amount: 1000n,
      });

      expect(result).toMatchObject({
        txHash: '0xtxhash',
        tokenAddress: TOKEN,
        spender: SPENDER,
        amount: 1000n,
        chainId: CHAIN,
        walletAddress: WALLET_ADDRESS,
        gasUsed: 21000,
        status: 'confirmed',
      });
    });

    it('revokes to 0 first when a non-zero, non-matching allowance exists', async () => {
      // Allowance read returns 500; the safe pattern must revoke (approve 0)
      // before setting the new amount. We assert the first write call uses 0n.
      const writeCalls: bigint[] = [];
      MockedContract
        .mockImplementationOnce(() => readContract(500n)) // allowance read
        .mockImplementation(() =>
          writeContract((_spender, amount) => {
            writeCalls.push(amount);
            return Promise.resolve(txWithReceipt(1));
          }),
        );

      await service.approveToken({
        chainId: CHAIN,
        tokenAddress: TOKEN,
        spender: SPENDER,
        amount: 1000n,
      });

      // First write = revoke (0n), second write = new amount.
      expect(writeCalls).toEqual([0n, 1000n]);
    });

    it('skips revoke when current allowance already equals the target amount', async () => {
      // Allowance equals target -> no revoke, single approve of the same amount.
      const writeCalls: bigint[] = [];
      MockedContract
        .mockImplementationOnce(() => readContract(1000n))
        .mockImplementation(() =>
          writeContract((_s, amount) => {
            writeCalls.push(amount);
            return Promise.resolve(txWithReceipt(1));
          }),
        );

      await service.approveToken({
        chainId: CHAIN,
        tokenAddress: TOKEN,
        spender: SPENDER,
        amount: 1000n,
      });

      expect(writeCalls).toEqual([1000n]);
    });

    it('marks status failed when the receipt status is 0 (reverted)', async () => {
      MockedContract
        .mockImplementationOnce(() => readContract(0n))
        .mockImplementationOnce(() =>
          writeContract(() => Promise.resolve(txWithReceipt(0))),
        );

      const result = await service.approveToken({
        chainId: CHAIN,
        tokenAddress: TOKEN,
        spender: SPENDER,
        amount: 1000n,
      });

      expect(result.status).toBe('failed');
      expect(result.gasUsed).toBe(21000);
    });

    it('rethrows and records error metrics when approve throws', async () => {
      MockedContract
        .mockImplementationOnce(() => readContract(0n))
        .mockImplementationOnce(() =>
          writeContract(() => Promise.reject(new Error('rpc down'))),
        );

      await expect(
        service.approveToken({
          chainId: CHAIN,
          tokenAddress: TOKEN,
          spender: SPENDER,
          amount: 1000n,
        }),
      ).rejects.toThrow('rpc down');
    });
  });

  describe('revokeApproval', () => {
    it('approves 0 and returns a confirmed revoke result with the caller chainId', async () => {
      const writeCalls: bigint[] = [];
      MockedContract.mockImplementation(() =>
        writeContract((_s, amount) => {
          writeCalls.push(amount);
          return Promise.resolve(txWithReceipt(1));
        }),
      );

      const result = await service.revokeApproval({
        chainId: CHAIN,
        tokenAddress: TOKEN,
        spender: SPENDER,
      });

      expect(writeCalls).toEqual([0n]);
      expect(result).toMatchObject({
        amount: 0n,
        chainId: CHAIN,
        walletAddress: WALLET_ADDRESS,
        status: 'confirmed',
      });
    });

    it('rethrows and records error metrics when revoke throws', async () => {
      MockedContract.mockImplementation(() =>
        writeContract(() => Promise.reject(new Error('nonce too low'))),
      );

      await expect(
        service.revokeApproval({
          chainId: CHAIN,
          tokenAddress: TOKEN,
          spender: SPENDER,
        }),
      ).rejects.toThrow('nonce too low');
    });
  });

  describe('getAllowance', () => {
    it('returns the on-chain allowance as a bigint', async () => {
      MockedContract.mockImplementationOnce(() => readContract(12345n));

      const allowance = await service.getAllowance({
        chainId: CHAIN,
        tokenAddress: TOKEN,
        owner: WALLET_ADDRESS,
        spender: SPENDER,
      });

      expect(allowance).toBe(12345n);
    });
  });

  describe('getApprovalInfo', () => {
    it('returns full approval info (token/owner/spender/allowance/chain)', async () => {
      MockedContract.mockImplementationOnce(() => readContract(777n));

      const info = await service.getApprovalInfo({
        chainId: CHAIN,
        tokenAddress: TOKEN,
        owner: WALLET_ADDRESS,
        spender: SPENDER,
      });

      expect(info).toEqual({
        tokenAddress: TOKEN,
        owner: WALLET_ADDRESS,
        spender: SPENDER,
        allowance: 777n,
        chainId: CHAIN,
      });
    });
  });

  describe('receipt edge cases', () => {
    it('reports status failed and undefined gasUsed when tx.wait() returns null receipt', async () => {
      MockedContract
        .mockImplementationOnce(() => readContract(0n))
        .mockImplementationOnce(() =>
          writeContract(() =>
            Promise.resolve({ hash: '0x', wait: jest.fn().mockResolvedValue(null) }),
          ),
        );

      const result = await service.approveToken({
        chainId: CHAIN,
        tokenAddress: TOKEN,
        spender: SPENDER,
        amount: 1000n,
      });

      expect(result.status).toBe('failed');
      expect(result.gasUsed).toBeUndefined();
    });
  });
});
