import { Module } from '@nestjs/common';

import { AuditClientModule, HealthModule } from '@arbibot/nest-platform';

import { DatabaseModule } from './database/database.module';
import { ExecutionModule } from './execution/execution.module';
import { LegsModule } from './legs/legs.module';
import { PlansModule } from './plans/plans.module';
import { WalletKeyStoreModule } from './execution/wallet-key-store.module';

@Module({
  imports: [
    HealthModule,
    AuditClientModule,
    DatabaseModule,
    // WalletKeyStoreModule is @Global: it binds the WALLET_KEY_STORE token so the
    // @Global KeyVaultModule's KeyVaultService can see the TypeORM adapter (PLAN12 #1).
    // Listed before ExecutionModule for clarity; @Global scope makes order irrelevant.
    WalletKeyStoreModule,
    ExecutionModule,
    PlansModule,
    LegsModule,
  ],
})
export class AppModule {}
