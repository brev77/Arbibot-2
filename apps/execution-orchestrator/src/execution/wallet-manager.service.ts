import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Provider, Wallet, formatUnits, Contract } from 'ethers';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WalletState } from '@arbibot/persistence';
import { KeyVaultService, WalletKey, EncryptedKey, getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { Counter, Gauge } from 'prom-client';
import { Address, ChainId } from '@arbibot/contracts-eth';

/**
 * Wallet selection strategy
 */
export enum WalletSelectionStrategy {
  ROUND_ROBIN = 'round-robin',
  WEIGHTED = 'weighted',
  BALANCE_BASED = 'balance-based',
}

/**
 * Wallet balance info
 */
export interface WalletBalance {
  address: Address;
  chainId: ChainId;
  tokenSymbol: string;
  tokenAddress: Address;
  balance: bigint;
  formattedBalance: string;
  decimals: number;
}

/**
 * Wallet selection result
 */
export interface SelectedWallet {
  keyId: string;
  address: Address;
  chainId: ChainId;
  wallet: Wallet;
}

/**
 * Wallet Manager Service
 * Step: DEX-1-0-WALLET-MGT
 * 
 * Manages multiple wallets: selection, balance checking, load balancing
 */
@Injectable()
export class WalletManagerService implements OnModuleInit {
  private readonly logger = new Logger(WalletManagerService.name);
  private readonly strategy: WalletSelectionStrategy;
  private roundRobinIndex = 0;

  // Cache for wallet instances
  private walletCache = new Map<string, Wallet>();

  // Metrics
  private selectionCounter!: Counter<string>;
  private insufficientFundsCounter!: Counter<string>;
  private balanceGauge!: Gauge<string>;

  constructor(
    @InjectRepository(WalletState)
    private readonly walletStateRepository: Repository<WalletState>,
    private readonly keyVaultService: KeyVaultService,
  ) {
    // Parse selection strategy from env
    this.strategy = (process.env.WALLET_SELECTION_STRATEGY as WalletSelectionStrategy) || WalletSelectionStrategy.ROUND_ROBIN;
  }

  async onModuleInit() {
    this.initializeMetrics();
    this.logger.log('Wallet Manager Service initialized with strategy: ' + this.strategy);
    await this.loadWalletStates();
  }

  /**
   * Load wallet states from database
   */
  private async loadWalletStates(): Promise<void> {
    try {
      const states = await this.walletStateRepository.find({
        where: { status: 'active' },
      });
      this.logger.log(`Loaded ${states.length} active wallet states`);
    } catch (error) {
      this.logger.error('Failed to load wallet states:', error);
    }
  }

  /**
   * Select a wallet for a transaction
   * @param chainId - Chain ID
   * @param provider - RPC provider
   * @param tokenAddress - Token address to check balance (optional)
   * @param minBalance - Minimum required balance in token units (optional)
   * @param tokenDecimals - Token decimals (default 18)
   */
  async selectWallet(
    chainId: ChainId,
    provider: Provider,
    tokenAddress?: Address,
    minBalance?: bigint,
    tokenDecimals: number = 18
  ): Promise<SelectedWallet> {
    // Get available wallet keys for this chain
    const walletKeys = this.keyVaultService.getWalletKeysByChain(chainId);

    if (walletKeys.length === 0) {
      throw new Error(`No active wallets available for chain ${chainId}`);
    }

    // Select wallet based on strategy
    const selectedKey = await this.selectWalletByStrategy(walletKeys, minBalance, tokenAddress, provider, tokenDecimals);

    // Get or create wallet instance
    let wallet = this.walletCache.get(selectedKey.keyId);
    if (!wallet) {
      const encryptedKey = this.getEncryptedKey(selectedKey.keyId);
      const privateKey = await this.keyVaultService.decryptPrivateKey(encryptedKey);
      wallet = new Wallet(privateKey, provider);
      this.walletCache.set(selectedKey.keyId, wallet);
    }

    // Update last used timestamp
    this.keyVaultService.updateKeyLastUsed(selectedKey.keyId);

    // Update wallet state in database
    void this.updateWalletState(selectedKey.keyId, wallet);

    // Record metrics
    this.selectionCounter.inc({ chain_id: String(chainId), strategy: this.strategy });

    this.logger.debug(`Selected wallet ${selectedKey.address} for chain ${chainId}`);

    return {
      keyId: selectedKey.keyId,
      address: selectedKey.address as Address,
      chainId: selectedKey.chainId,
      wallet,
    };
  }

  /**
   * Select wallet by configured strategy
   */
  private async selectWalletByStrategy(
    walletKeys: WalletKey[],
    minBalance: bigint | undefined,
    tokenAddress: Address | undefined,
    provider: Provider,
    tokenDecimals: number
  ): Promise<WalletKey> {
    switch (this.strategy) {
      case WalletSelectionStrategy.ROUND_ROBIN:
        return this.selectRoundRobin(walletKeys);

      case WalletSelectionStrategy.WEIGHTED:
        return this.selectWeighted(walletKeys);

      case WalletSelectionStrategy.BALANCE_BASED:
        return await this.selectByBalance(walletKeys, minBalance, tokenAddress, provider, tokenDecimals);

      default:
        return this.selectRoundRobin(walletKeys);
    }
  }

  /**
   * Round-robin selection
   */
  private selectRoundRobin(walletKeys: WalletKey[]): WalletKey {
    const key = walletKeys[this.roundRobinIndex % walletKeys.length]!;
    this.roundRobinIndex++;
    return key;
  }

  /**
   * Weighted selection (based on last used time - prefer less recently used)
   */
  private selectWeighted(walletKeys: WalletKey[]): WalletKey {
    // Sort by last used time (least recently used first)
    const sorted = [...walletKeys].sort((a, b) => {
      const timeA = a.lastUsedAt?.getTime() || 0;
      const timeB = b.lastUsedAt?.getTime() || 0;
      return timeA - timeB;
    });

    // Return the least recently used
    return sorted[0]!;
  }

  /**
   * Balance-based selection (prefer wallets with sufficient balance)
   */
  private async selectByBalance(
    walletKeys: WalletKey[],
    minBalance: bigint | undefined,
    tokenAddress: Address | undefined,
    provider: Provider,
    _tokenDecimals: number
  ): Promise<WalletKey> {
    if (!minBalance || !tokenAddress) {
      // If no balance requirements, use weighted selection
      return this.selectWeighted(walletKeys);
    }

    // Check balances for all wallets
    for (const walletKey of walletKeys) {
      try {
        const encryptedKey = this.getEncryptedKey(walletKey.keyId);
        const privateKey = await this.keyVaultService.decryptPrivateKey(encryptedKey);
        const wallet = new Wallet(privateKey, provider);

        // Get token balance
        const balance = await this.getTokenBalance(provider, wallet.address as Address, tokenAddress);

        if (balance >= minBalance) {
          // Update balance gauge
          this.balanceGauge.set({
            chain_id: String(walletKey.chainId),
            address: walletKey.address,
            token: tokenAddress,
          }, Number(balance));

          return walletKey;
        }
      } catch (error) {
        this.logger.warn(`Failed to check balance for wallet ${walletKey.address}:`, error);
      }
    }

    // No wallet has sufficient balance
    this.insufficientFundsCounter.inc({ chain_id: String(walletKeys[0]!.chainId) });
    throw new Error(`No wallet has sufficient balance (required: ${minBalance} units)`);
  }

  /**
   * Get token balance for a wallet
   */
  async getTokenBalance(
    provider: Provider,
    address: Address,
    tokenAddress: Address
  ): Promise<bigint> {
    try {
      // ERC20 balanceOf function signature
      const balanceOfAbi = [
        'function balanceOf(address owner) view returns (uint256)',
      ];
      const contract = new Contract(tokenAddress, balanceOfAbi, provider) as any;
      const balance = await contract.balanceOf(address);
      return BigInt(balance);
    } catch (error) {
      this.logger.error(`Failed to get token balance for ${address}:`, error);
      throw error;
    }
  }

  /**
   * Get detailed wallet balance info
   */
  async getWalletBalanceInfo(
    provider: Provider,
    address: Address,
    tokenAddress: Address,
    tokenSymbol: string,
    decimals: number
  ): Promise<WalletBalance> {
    const balance = await this.getTokenBalance(provider, address, tokenAddress);
    const formattedBalance = formatUnits(balance, decimals);
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId) as ChainId;

    return {
      address,
      chainId,
      tokenSymbol,
      tokenAddress,
      balance,
      formattedBalance,
      decimals,
    };
  }

  /**
   * Check if wallet has sufficient balance
   */
  async hasSufficientBalance(
    provider: Provider,
    address: Address,
    tokenAddress: Address,
    requiredAmount: bigint
  ): Promise<boolean> {
    try {
      const balance = await this.getTokenBalance(provider, address, tokenAddress);
      return balance >= requiredAmount;
    } catch (error) {
      this.logger.error(`Failed to check sufficient balance for ${address}:`, error);
      return false;
    }
  }

  /**
   * Update wallet state in database
   */
  private async updateWalletState(keyId: string, wallet: Wallet): Promise<void> {
    try {
      const walletKey = this.keyVaultService.getWalletKey(keyId);
      if (!walletKey) {
        return;
      }

      let walletState = await this.walletStateRepository.findOne({
        where: { walletAddress: wallet.address as Address, chainId: walletKey.chainId },
      });

      if (walletState) {
        // Update existing state
        walletState.nonce = Number(await wallet.getNonce());
        walletState.status = 'active';
        walletState.updatedAt = new Date();
      } else {
        // Create new state
        walletState = this.walletStateRepository.create({
          keyId,
          walletAddress: wallet.address as Address,
          chainId: walletKey.chainId,
          nonce: Number(await wallet.getNonce()),
          status: 'active',
        });
      }

      await this.walletStateRepository.save(walletState);
    } catch (error) {
      this.logger.error(`Failed to update wallet state for ${wallet.address}:`, error);
    }
  }

  /**
   * Get encrypted key data from vault
   */
  private getEncryptedKey(keyId: string): EncryptedKey {
    const encryptedKey = this.keyVaultService.retrieveEncryptedKey(keyId);
    if (!encryptedKey) {
      throw new Error(`Encrypted key not found for keyId: ${keyId} — ensure key was stored via encryptPrivateKey or storeEncryptedKey`);
    }
    return encryptedKey;
  }

  /**
   * Clear wallet cache (useful for key rotation)
   */
  clearWalletCache(): void {
    this.walletCache.clear();
    this.logger.debug('Wallet cache cleared');
  }

  /**
   * Initialize metrics
   */
  private initializeMetrics(): void {
    const registry = getArbibotMetricsRegistry();

    // Selection counter
    this.selectionCounter = new Counter({
      name: 'arb_wallet_selection_total',
      help: 'Total wallet selections',
      labelNames: ['chain_id', 'strategy'],
      registers: [registry],
    });

    // Insufficient funds counter
    this.insufficientFundsCounter = new Counter({
      name: 'arb_wallet_insufficient_funds_total',
      help: 'Total insufficient funds errors',
      labelNames: ['chain_id'],
      registers: [registry],
    });

    // Balance gauge
    this.balanceGauge = new Gauge({
      name: 'arb_wallet_balance',
      help: 'Wallet balance in smallest token units',
      labelNames: ['chain_id', 'address', 'token'],
      registers: [registry],
    });
  }
}