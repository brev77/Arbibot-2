import { Global, Module } from '@nestjs/common';
import { KeyVaultService } from './key-vault.service';

@Global()
@Module({
  providers: [KeyVaultService],
  exports: [KeyVaultService],
})
export class KeyVaultModule {}