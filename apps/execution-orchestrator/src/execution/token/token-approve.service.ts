import { Injectable, Logger } from '@nestjs/common';
import { JsonRpcProvider, Contract, Wallet, ContractTransactionResponse, Provider } from 'ethers';
import { Counter, Gauge } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { ChainId, Address } from '@arbibot/contracts-eth';
import { WalletManagerService } from '../wallet-manager.service';
import { NonceManagerService } from '../nonce-manager.service';
import { waitForConfirmation } from '../tx-confirmation.service';
import { RpcProviderManager } from '../rpc/rpc-provider-manager.service';

/**
 * Pre-selected wallet (P9-6): when the caller (adapter) has already chosen a
 * wallet for the swap, it passes it here so approve + swap use the SAME wallet.
 * Previously approveToken called selectWallet(chainId, provider) WITHOUT
 * token/amount args → round-robin could pick a different wallet than the swap,
 * leaving allowance forever 0 on the swap wallet.
 */
export interface PreselectedWallet {
  address: Address;
  wallet: Wallet;
}

/**
 * Typed ERC20 contract with write methods (connected to wallet)
 */
interface Erc20Contract {
  approve(spender: string, amount: bigint, overrides?: { nonce?: number }): Promise<ContractTransactionResponse>;
}

/**
 * Typed ERC20 contract with read methods (connected to provider)
 */
interface Erc20ReadContract {
  allowance(owner: string, spender: string): Promise<bigint>;
}

/**
 * ERC20 approve/revoke result
 */
export interface ApproveResult {
  txHash: string;
  tokenAddress: Address;
  spender: Address;
  amount: bigint;
  chainId: ChainId;
  walletAddress: Address;
  gasUsed?: number;
  status: 'confirmed' | 'pending' | 'failed';
}

/**
 * Current approval info
 */
export interface ApprovalInfo {
  tokenAddress: Address;
  owner: Address;
  spender: Address;
  allowance: bigint;
  chainId: ChainId;
}

/**
 * Token Approve Service
 * Step: DEX-1-1-APPROVE-PATTERN
 *
 * Manages ERC20 approve/revoke operations for DEX trading.
 * Follows safe approval patterns:
 * - Prefer revoking to zero before setting new allowance
 * - Use exact amounts instead of MAX_UINT256 where possible
 * - Track all approvals for audit
 */
@Injectable()
export class TokenApproveService {
  private readonly logger = new Logger(TokenApproveService.name);

  // ERC20 ABI fragments for approval operations
  private static readonly ERC20_ABI = [
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
  ];

  // Metrics
  private approveCounter!: Counter<string>;
  private revokeCounter!: Counter<string>;
  private approvalGauge!: Gauge<string>;

  constructor(
    private readonly walletManager: WalletManagerService,
    private readonly rpcProviderManager: RpcProviderManager,
    private readonly nonceManager: NonceManagerService,
  ) {
    this.initializeMetrics();
  }

  /**
   * Approve a spender to spend tokens on behalf of a wallet
   * Uses safe pattern: revoke to 0 first if current allowance > 0
   *
   * P9-6: when `wallet` is provided (adapter pre-selected the swap wallet),
   * approve uses THAT wallet — guaranteeing approve + swap run from the same
   * address. Without this, selectWallet(chainId, provider) without token/amount
   * could round-robin to a different wallet, leaving allowance 0 on the swap
   * wallet forever.
   */
  async approveToken(params: {
    chainId: ChainId;
    tokenAddress: Address;
    spender: Address;
    amount: bigint;
    walletKeyId?: string;
    wallet?: PreselectedWallet;
  }): Promise<ApproveResult> {
    const { chainId, tokenAddress, spender, amount } = params;

    try {
      const provider = this.rpcProviderManager.getProvider(chainId) as JsonRpcProvider;
      // P9-6: prefer the caller-supplied wallet (the swap wallet) over a fresh
      // round-robin selection. Only fall back to selectWallet when no wallet is
      // provided (standalone approve path, e.g. operator-initiated revoke).
      let walletInstance: Wallet = params.wallet?.wallet as Wallet;
      if (walletInstance === undefined) {
        const selected = await this.walletManager.selectWallet(chainId, provider);
        walletInstance = selected.wallet;
      }
      const walletAddress = walletInstance.address as Address;

      // Check current allowance
      const currentAllowance = await this.getAllowance({
        chainId,
        tokenAddress,
        owner: walletAddress,
        spender,
      });

      // Safe approval pattern: revoke to 0 if non-zero allowance exists
      if (currentAllowance > 0n && currentAllowance !== amount) {
        this.logger.log(`Revoking current allowance ${currentAllowance} before setting new amount`);
        await this.revokeInternal(provider, walletInstance, tokenAddress, spender, chainId);
      }

      // Send approve transaction (P9-3: explicit nonce under per-wallet lock)
      const tokenContract = new Contract(
        tokenAddress,
        TokenApproveService.ERC20_ABI,
        walletInstance,
      ) as unknown as Erc20Contract;

      const tx = await this.nonceManager.withBroadcastLock(
        chainId,
        walletInstance.address as Address,
        walletInstance.provider as Provider,
        (nonce) => tokenContract.approve(spender, amount, { nonce }),
      );
      this.logger.log(`Approve tx sent: ${tx.hash} for ${tokenAddress} → ${spender}`);

      // Wait for confirmation (1 block) — outside the nonce lock
      const receipt = await waitForConfirmation(tx, chainId);

      const result: ApproveResult = {
        txHash: tx.hash,
        tokenAddress,
        spender,
        amount,
        chainId,
        walletAddress: walletInstance.address as Address,
        gasUsed: receipt ? Number(receipt.gasUsed) : undefined,
        status: receipt && receipt.status === 1 ? 'confirmed' : 'failed',
      };

      // Record metrics
      this.approveCounter.inc({
        chain_id: String(chainId),
        status: result.status,
      });

      this.approvalGauge.set(
        { chain_id: String(chainId), token: tokenAddress, spender },
        Number(amount),
      );

      return result;
    } catch (error) {
      this.approveCounter.inc({ chain_id: String(chainId), status: 'error' });
      this.logger.error(`Failed to approve ${tokenAddress} for ${spender}:`, error);
      throw error;
    }
  }

  /**
   * Revoke (set to 0) an existing approval
   */
  async revokeApproval(params: {
    chainId: ChainId;
    tokenAddress: Address;
    spender: Address;
  }): Promise<ApproveResult> {
    const { chainId, tokenAddress, spender } = params;

    try {
      const provider = this.rpcProviderManager.getProvider(chainId) as JsonRpcProvider;
      const selectedWallet = await this.walletManager.selectWallet(chainId, provider);

      const result = await this.revokeInternal(provider, selectedWallet.wallet, tokenAddress, spender, chainId);

      this.revokeCounter.inc({ chain_id: String(chainId) });
      this.approvalGauge.set(
        { chain_id: String(chainId), token: tokenAddress, spender },
        0,
      );

      return { ...result, chainId, walletAddress: selectedWallet.address };
    } catch (error) {
      this.revokeCounter.inc({ chain_id: String(chainId), status: 'error' });
      this.logger.error(`Failed to revoke approval for ${tokenAddress} → ${spender}:`, error);
      throw error;
    }
  }

  /**
   * Get current allowance for a token/spender pair
   */
  async getAllowance(params: {
    chainId: ChainId;
    tokenAddress: Address;
    owner: Address;
    spender: Address;
  }): Promise<bigint> {
    const provider = this.rpcProviderManager.getProvider(params.chainId) as JsonRpcProvider;

    const tokenContract = new Contract(
      params.tokenAddress,
      TokenApproveService.ERC20_ABI,
      provider,
    ) as unknown as Erc20ReadContract;

    const allowance = await tokenContract.allowance(params.owner, params.spender);
    return BigInt(allowance);
  }

  /**
   * Get full approval info
   */
  async getApprovalInfo(params: {
    chainId: ChainId;
    tokenAddress: Address;
    owner: Address;
    spender: Address;
  }): Promise<ApprovalInfo> {
    const allowance = await this.getAllowance(params);

    return {
      tokenAddress: params.tokenAddress,
      owner: params.owner,
      spender: params.spender,
      allowance,
      chainId: params.chainId,
    };
  }

  /**
   * Internal revoke implementation (P9-3: nonce-locked)
   */
  private async revokeInternal(
    provider: JsonRpcProvider,
    wallet: Wallet,
    tokenAddress: Address,
    spender: Address,
    chainId: ChainId,
  ): Promise<ApproveResult> {
    const tokenContract = new Contract(
      tokenAddress,
      TokenApproveService.ERC20_ABI,
      wallet,
    ) as unknown as Erc20Contract;

    const tx = await this.nonceManager.withBroadcastLock(
      chainId,
      wallet.address as Address,
      wallet.provider as Provider,
      (nonce) => tokenContract.approve(spender, 0n, { nonce }),
    );
    this.logger.log(`Revoke tx sent: ${tx.hash} for ${tokenAddress} → ${spender}`);

    const receipt = await waitForConfirmation(tx, chainId);

    return {
      txHash: tx.hash,
      tokenAddress,
      spender,
      amount: 0n,
      chainId,
      walletAddress: wallet.address as Address,
      gasUsed: receipt ? Number(receipt.gasUsed) : undefined,
      status: receipt && receipt.status === 1 ? 'confirmed' : 'failed',
    };
  }

  /**
   * Initialize metrics
   */
  private initializeMetrics(): void {
    const registry = getArbibotMetricsRegistry();

    this.approveCounter = new Counter({
      name: 'arb_dex_token_approve_total',
      help: 'Total ERC20 approve operations',
      labelNames: ['chain_id', 'status'],
      registers: [registry],
    });

    this.revokeCounter = new Counter({
      name: 'arb_dex_token_revoke_total',
      help: 'Total ERC20 revoke operations',
      labelNames: ['chain_id', 'status'],
      registers: [registry],
    });

    this.approvalGauge = new Gauge({
      name: 'arb_dex_token_allowance',
      help: 'Current ERC20 allowance',
      labelNames: ['chain_id', 'token', 'spender'],
      registers: [registry],
    });
  }
}