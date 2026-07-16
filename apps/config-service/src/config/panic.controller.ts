import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';

import {
  PanicActionDto,
  PanicRecoverDto,
} from './panic.dto';
import { PanicService } from './panic.service';

/**
 * Panic-button HTTP surface (D4-C-3-PANIC). Frontend "EMERGENCY STOP" button POSTs
 * here; the BFF injects `operatorId` from the operator session.
 *
 * Scope: this controller flips the **live capital** kill-switch (`dex.limits.killSwitch`)
 * only — the part that loses money. Paper-discovery / risk-policy-jobs (env-read flags)
 * are flipped by the CLI `npm run panic:stop`; the stop response carries a follow-up
 * instruction so the operator knows the UI flow is not the complete panic surface.
 *
 * Routes are under `/policy/system/*` to live alongside other config-service policy
 * mutations and inherit its auth/RBAC (operator role enforced by the web BFF).
 */
@Controller('policy/system')
export class PanicController {
  constructor(private readonly panic: PanicService) {}

  /** Emergency stop: halt the live capital path. Idempotent. */
  @Post('panic-stop')
  @HttpCode(HttpStatus.OK)
  async panicStop(@Body() dto: PanicActionDto) {
    return this.panic.panicStop(dto);
  }

  /** Resume trading. Requires the typed confirmation phrase. */
  @Post('panic-recover')
  @HttpCode(HttpStatus.OK)
  async panicRecover(@Body() dto: PanicRecoverDto) {
    return this.panic.panicRecover(dto);
  }
}
