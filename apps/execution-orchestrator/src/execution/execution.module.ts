import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { KeyVaultModule } from '@arbibot/nest-platform';
import { BridgeTransferEntity, ExecutionLegEntity, ExecutionPlanEntity, OnChainTransaction, WalletState } from '@arbibot/persistence';

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
import { PancakeSwapV2Adapter } from './adapters/pancakeswap-v2.adapter';
import { BiswapV2Adapter } from './adapters/biswap-v2.adapter';
import { PaperDexAdapter } from './adapters/paper-dex.adapter';
import { DexMempoolMonitorWorker } from './workers/dex-mempool-monitor.worker';
import { DexHealthService } from './dex-health.service';
import { DexHealthController } from './dex-health.controller';
import { DexMetricsService } from './dex-metrics.service';
import { AcrossBridgeAdapter } from './bridge/across-bridge.adapter';
import { StargateBridgeAdapter } from './bridge/stargate-bridge.adapter';
import { NativeBridgeAdapter } from './bridge/native-bridge.adapter';
import { BridgeTransferService } from './bridge/bridge-transfer.service';
import { BridgeAdapterFactoryService } from './bridge/bridge-adapter-factory.service';
import { BridgeTransferPollingWorker } from './workers/bridge-transfer-polling.worker';
import { CrossChainReconciliationService } from './reconciliation/cross-chain-reconciliation.service';
import { BridgeReconController } from './reconciliation/bridge-recon.controller';
import { CrossChainReconWorker } from './workers/cross-chain-recon.worker';

@Module({
  imports: [
    KeyVaultModule,
    TypeOrmModule.forFeature([WalletState, OnChainTransaction, BridgeTransferEntity, ExecutionLegEntity, ExecutionPlanEntity]),
  ],
  controllers: [RpcHealthController, DexHealthController, BridgeReconController],
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
    PancakeSwapV2Adapter,
    BiswapV2Adapter,
    PaperDexAdapter,
    DexMempoolMonitorWorker,
    DexHealthService,
    DexMetricsService,
    AcrossBridgeAdapter,
    StargateBridgeAdapter,
    NativeBridgeAdapter,
    BridgeTransferService,
    BridgeAdapterFactoryService,
    BridgeTransferPollingWorker,
    CrossChainReconciliationService,
    CrossChainReconWorker,
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
    PancakeSwapV2Adapter,
    BiswapV2Adapter,
    PaperDexAdapter,
    DexMempoolMonitorWorker,
    DexHealthService,
    DexMetricsService,
    AcrossBridgeAdapter,
    StargateBridgeAdapter,
    NativeBridgeAdapter,
    BridgeTransferService,
    BridgeAdapterFactoryService,
    BridgeTransferPollingWorker,
    CrossChainReconciliationService,
    CrossChainReconWorker,
  ],
})
export class ExecutionModule {}
