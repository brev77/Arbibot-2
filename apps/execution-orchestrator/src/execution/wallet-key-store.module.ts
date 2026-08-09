import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletKeyEntity } from '@arbibot/persistence';
import { WALLET_KEY_STORE } from '@arbibot/nest-platform';

import { TypeOrmWalletKeyStore } from './wallet-key-store.typeorm';

/**
 * Global registration of the {@link WALLET_KEY_STORE} port (PLAN12 #1).
 *
 * Background — why this module exists separately from {@link ExecutionModule}:
 * `KeyVaultService` is declared in the `@Global` `KeyVaultModule` (nest-platform)
 * and injects `@Optional() @Inject(WALLET_KEY_STORE)`. For that injection to
 * resolve, the token must be visible in the GLOBAL scope — NestJS `@Global()`
 * broadcasts a module's own exports outward, but a `@Global` module's providers
 * cannot see providers registered inside a *non-global, non-exporting* module
 * that happens to import it.
 *
 * The previous binding (`{ provide: WALLET_KEY_STORE, useExisting }` inside the
 * non-`@Global` `ExecutionModule`, token not in `exports`) was therefore
 * invisible to `KeyVaultService` → `@Optional()` resolved to `undefined` → the
 * service silently fell back to in-memory persistence → live wallet keys never
 * loaded → `selectWallet` hung (Aéza incident 2026-08-06). The server-side
 * `attachStore()` late-bind workaround masked this; the correct fix is to bind
 * the token in a scope `KeyVaultService` can actually see.
 *
 * This module is `@Global()` so the token is app-wide, matching the port's
 * documented intent ("bound by the host app… KeyVaultService falls back to
 * in-memory when unbound", wallet-key-store.ts). Single-writer boundary is
 * unchanged: plaintext keys are produced solely inside KeyVaultService (the K2
 * leakage-guard owner); this module only wires the persistence port.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([WalletKeyEntity])],
  providers: [TypeOrmWalletKeyStore, { provide: WALLET_KEY_STORE, useExisting: TypeOrmWalletKeyStore }],
  exports: [WALLET_KEY_STORE, TypeOrmWalletKeyStore],
})
export class WalletKeyStoreModule {}
