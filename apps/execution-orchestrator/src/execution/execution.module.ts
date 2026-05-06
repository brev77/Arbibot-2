import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { KeyVaultModule } from '@arbibot/nest-platform';
import { OnChainTransaction, WalletState } from '@arbibot/persistence';

import { WalletManagerService } from './wallet-manager.service';
import { DexFillTrackerService } from './dex-fill-tracker.service';
import { DexOutboxEventsService } from './dex-outbox-events.service';
import { GasEstimatorService } from './gas/gas-estimator.service';
import { RpcProviderManager } from './rpc/rpc-provider-manager.service';
import { RpcHealthController } from './rpc/rpc-health.controller';
import { PoolDiscoveryService } from './pool/pool-discovery.service';
import { DexRiskPolicyService } from './risk/dex-risk-policy.service';
import { TokenApproveService } from './token/token-approve.service';
import { SlippageProtectionService } from './slippage/slippage-protection.service';
import { UniswapV2Adapter } from './adapters/uniswap-v2.adapter';
import { UniswapV3Adapter } from './adapters/uniswap-v3.adapter';
import { SushiSwapV2Adapter } from './adapters/sushiswap-v2.adapter';

@Module({
  imports: [
    KeyVaultModule,
    TypeOrmModule.forFeature([WalletState, OnChainTransaction]),
  ],
  controllers: [RpcHealthController],
  providers: [
    WalletManagerService,
    DexFillTrackerService,
    DexOutboxEventsService,
    RpcProviderManager,
    GasEstimatorService,
    PoolDiscoveryService,
    DexRiskPolicyService,
    TokenApproveService,
    SlippageProtectionService,
    UniswapV2Adapter,
    UniswapV3Adapter,
    SushiSwapV2Adapter,
  ],
  exports: [
    WalletManagerService,
    DexFillTrackerService,
    DexOutboxEventsService,
    GasEstimatorService,
    PoolDiscoveryService,
    DexRiskPolicyService,
    TokenApproveService,
    SlippageProtectionService,
    UniswapV2Adapter,
    UniswapV3Adapter,
    SushiSwapV2Adapter,
  ],
})
export class ExecutionModule {}
