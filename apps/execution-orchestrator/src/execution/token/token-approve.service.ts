import { Injectable, Logger } from '@nestjs/common';
import { JsonRpcProvider, Contract, Wallet, TransactionReceipt, parseUnits } from 'ethers';
import { Counter, Gauge } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { ChainId, Address } from '@arbibot/contracts-eth';
import { WalletManagerService } from '../wallet-manager.service';
import { RpcProviderManager } from '../rpc/rpc-provider-manager.service';

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
  ) {
    this.initializeMetrics();
  }

  /**
   * Approve a spender to spend tokens on behalf of a wallet
   * Uses safe pattern: revoke to 0 first if current allowance > 0
   */
  async approveToken(params: {
    chainId: ChainId;
    tokenAddress: Address;
    spender: Address;
    amount: bigint;
    walletKeyId?: string;
  }): Promise<ApproveResult> {
    const { chainId, tokenAddress, spender, amount } = params;
    const startTime = Date.now();

    try {
      const provider = this.rpcProviderManager.getProvider(chainId) as JsonRpcProvider;
      const selectedWallet = await this.walletManager.selectWallet(chainId, provider);

      // Check current allowance
      const currentAllowance = await this.getAllowance({
        chainId,
        tokenAddress,
        owner: selectedWallet.address,
        spender,
      });

      // Safe approval pattern: revoke to 0 if non-zero allowance exists
      if (currentAllowance > 0n && currentAllowance !== amount) {
        this.logger.log(`Revoking current allowance ${currentAllowance} before setting new amount`);
        await this.revokeInternal(provider, selectedWallet.wallet, tokenAddress, spender);
      }

      // Send approve transaction
      const tokenContract = new Contract(
        tokenAddress,
        TokenApproveService.ERC20_ABI,
        selectedWallet.wallet,
      ) as any;

      const tx = await tokenContract.approve(spender, amount);
      this.logger.log(`Approve tx sent: ${tx.hash} for ${tokenAddress} → ${spender}`);

      // Wait for confirmation (1 block)
      const receipt: TransactionReceipt = await tx.wait(1);

      const result: ApproveResult = {
        txHash: tx.hash,
        tokenAddress,
        spender,
        amount,
        chainId,
        walletAddress: selectedWallet.address,
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

      const result = await this.revokeInternal(provider, selectedWallet.wallet, tokenAddress, spender);

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
    ) as any;

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
   * Internal revoke implementation
   */
  private async revokeInternal(
    provider: JsonRpcProvider,
    wallet: Wallet,
    tokenAddress: Address,
    spender: Address,
  ): Promise<ApproveResult> {
    const tokenContract = new Contract(
      tokenAddress,
      TokenApproveService.ERC20_ABI,
      wallet,
    ) as any;

    const tx = await tokenContract.approve(spender, 0);
    this.logger.log(`Revoke tx sent: ${tx.hash} for ${tokenAddress} → ${spender}`);

    const receipt: TransactionReceipt = await tx.wait(1);

    return {
      txHash: tx.hash,
      tokenAddress,
      spender,
      amount: 0n,
      chainId: 0 as ChainId, // Will be set by caller
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