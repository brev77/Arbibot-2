import { Global, Module } from '@nestjs/common';

import { AuditClientService } from './audit-client.service';

@Global()
@Module({
  providers: [AuditClientService],
  exports: [AuditClientService],
})
export class AuditClientModule {}
