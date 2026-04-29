import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { KeyVaultModule } from '@arbibot/nest-platform';
import { WalletState } from '@arbibot/persistence';

import { WalletManagerService } from './wallet-manager.service';
import { GasEstimatorService } from './gas/gas-estimator.service';
import { RpcProviderManager } from './rpc/rpc-provider-manager.service';

@Module({
  imports: [
    KeyVaultModule,
    TypeOrmModule.forFeature([WalletState]),
  ],
  providers: [WalletManagerService, RpcProviderManager, GasEstimatorService],
  exports: [WalletManagerService, GasEstimatorService],
})
export class ExecutionModule {}
