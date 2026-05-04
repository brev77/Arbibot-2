import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { KeyVaultModule } from '@arbibot/nest-platform';
import { WalletState } from '@arbibot/persistence';

import { WalletManagerService } from './wallet-manager.service';
import { GasEstimatorService } from './gas/gas-estimator.service';
import { RpcProviderManager } from './rpc/rpc-provider-manager.service';
import { RpcHealthController } from './rpc/rpc-health.controller';
import { PoolDiscoveryService } from './pool/pool-discovery.service';
import { DexRiskPolicyService } from './risk/dex-risk-policy.service';
import { TokenApproveService } from './token/token-approve.service';
import { SlippageProtectionService } from './slippage/slippage-protection.service';
import { UniswapV2Adapter } from './adapters/uniswap-v2.adapter';

@Module({
  imports: [
    KeyVaultModule,
    TypeOrmModule.forFeature([WalletState]),
  ],
  controllers: [RpcHealthController],
  providers: [
    WalletManagerService,
    RpcProviderManager,
    GasEstimatorService,
    PoolDiscoveryService,
    DexRiskPolicyService,
    TokenApproveService,
    SlippageProtectionService,
    UniswapV2Adapter,
  ],
  exports: [
    WalletManagerService,
    GasEstimatorService,
    PoolDiscoveryService,
    DexRiskPolicyService,
    TokenApproveService,
    SlippageProtectionService,
    UniswapV2Adapter,
  ],
})
export class ExecutionModule {}
