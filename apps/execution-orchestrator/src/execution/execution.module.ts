import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { KeyVaultModule, WALLET_KEY_STORE } from '@arbibot/nest-platform';
import {
  BridgeTransferEntity,
  DexDailyVolumeEntity,
  OnChainTransaction,
  WalletKeyEntity,
  WalletState,
} from '@arbibot/persistence';

import { WalletManagerService } from './wallet-manager.service';
import { TypeOrmWalletKeyStore } from './wallet-key-store.typeorm';
import { DexFillTrackerService } from './dex-fill-tracker.service';
import { DexOutboxEventsService } from './dex-outbox-events.service';
import { GasEstimatorService } from './gas/gas-estimator.service';
import { RpcProviderManager } from './rpc/rpc-provider-manager.service';
import { RpcHealthController } from './rpc/rpc-health.controller';
import { PoolDiscoveryService } from './pool/pool-discovery.service';
import { DexRiskPolicyService } from './risk/dex-risk-policy.service';
import { DexKillSwitchService } from './risk/dex-kill-switch.service';
import { PriceOracleService } from './price/price-oracle.service';
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
import { BridgeFinalityService } from './bridge/bridge-finality.service';
import { BridgeAdapterFactoryService } from './bridge/bridge-adapter-factory.service';
import { BridgeTransferPollingWorker } from './workers/bridge-transfer-polling.worker';
import { CrossChainReconciliationService } from './reconciliation/cross-chain-reconciliation.service';
import { BridgeReconController } from './reconciliation/bridge-recon.controller';
import { CrossChainReconWorker } from './workers/cross-chain-recon.worker';

@Module({
  imports: [
    KeyVaultModule,
    TypeOrmModule.forFeature([WalletState, OnChainTransaction, BridgeTransferEntity, DexDailyVolumeEntity, WalletKeyEntity]),
  ],
  controllers: [RpcHealthController, DexHealthController, BridgeReconController],
  providers: [
    WalletManagerService,
    TypeOrmWalletKeyStore,
    {
      // Bind the WalletKeyStore port to the TypeORM adapter so KeyVaultService
      // persists encrypted keys to the wallet_keys table (D4-B-4-KEYS).
      provide: WALLET_KEY_STORE,
      useExisting: TypeOrmWalletKeyStore,
    },
    DexFillTrackerService,
    DexOutboxEventsService,
    RpcProviderManager,
    GasEstimatorService,
    PoolDiscoveryService,
    DexRiskPolicyService,
    DexKillSwitchService,
    PriceOracleService,
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
    BridgeFinalityService,
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
    DexKillSwitchService,
    PriceOracleService,
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
    BridgeFinalityService,
    BridgeAdapterFactoryService,
    BridgeTransferPollingWorker,
    CrossChainReconciliationService,
    CrossChainReconWorker,
  ],
})
export class ExecutionModule {}
