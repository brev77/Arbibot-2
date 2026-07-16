import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { AuditRecordInput, IAuditClient } from '@arbibot/nest-platform';
import { AuditClientService } from '@arbibot/nest-platform';

import { ConfigurationsService } from './configurations.service';
import {
  PANIC_RECOVER_CONFIRM_PHRASE,
  type PanicActionDto,
  type PanicRecoverDto,
} from './panic.dto';
import { ConfigScopeType } from '../dto/create-configuration.dto';

/**
 * Panic-button service (D4-C-3-PANIC).
 *
 * The UI "EMERGENCY STOP" button calls this service to flip the **primary** capital
 * kill-switch — `dex.limits.killSwitch` — which `DexKillSwitchService` in the
 * execution-orchestrator reads from config-service (cached, refreshed on a short
 * TTL). Flipping it to `true` halts new live DEX legs within the cache TTL window.
 *
 * This is NOT the complete panic surface: `PAPER_DISCOVERY_ENABLED` and
 * `RISK_POLICY_JOBS_ENABLED` are env-read (not config-read), so they are flipped by
 * the CLI `tools/panic-button.sh`. The UI flow returns an explicit instruction
 * telling the operator to also run the CLI for the full panic. Rationale: the live
 * capital path (the part that loses money) is stopped immediately via config;
 * paper-discovery and policy-jobs are background workers that are safe to leave
 * running until the operator reaches a terminal.
 *
 * Recovery requires the typed confirmation phrase (`PANIC_RECOVER_CONFIRM_PHRASE`)
 * — resuming trading is never a single-click operation. See
 * `docs/adr-live-gate.md` (L8 descoped) for why two-person was replaced with
 * typed-confirm + audit.
 */
@Injectable()
export class PanicService {
  private readonly logger = new Logger(PanicService.name);

  constructor(
    private readonly configurations: ConfigurationsService,
    @Inject(AuditClientService) private readonly audit: IAuditClient,
  ) {}

  /** Halt the live capital path: set `dex.limits.killSwitch=true`. */
  async panicStop(dto: PanicActionDto): Promise<PanicResult> {
    const before = await this.readKillSwitch();
    if (before === true) {
      this.logger.warn(
        `panicStop: killSwitch already true (operator=${dto.operatorId}); no-op`,
      );
      await this.audit.appendEntry(this.auditPayload(dto, 'PANIC_STOP_NOOP', true));
      return {
        action: 'PANIC_STOP',
        killSwitchBefore: true,
        killSwitchAfter: true,
        alreadyHalted: true,
        followUpCli: this.followUpCliInstruction(),
      };
    }

    await this.setKillSwitch(true, dto.operatorId, dto.reason);
    await this.audit.appendEntry(
      this.auditPayload(dto, 'PANIC_STOP_TRIGGERED', true, dto.reason),
    );
    this.logger.warn(
      `panicStop: dex.limits.killSwitch set to true (operator=${dto.operatorId})`,
    );
    return {
      action: 'PANIC_STOP',
      killSwitchBefore: before ?? null,
      killSwitchAfter: true,
      alreadyHalted: false,
      followUpCli: this.followUpCliInstruction(),
    };
  }

  /** Resume the live capital path: set `dex.limits.killSwitch=false`. */
  async panicRecover(dto: PanicRecoverDto): Promise<PanicResult> {
    if (dto.confirm !== PANIC_RECOVER_CONFIRM_PHRASE) {
      throw new BadRequestException(
        `Confirmation phrase required: must equal "${PANIC_RECOVER_CONFIRM_PHRASE}"`,
      );
    }
    const before = await this.readKillSwitch();
    if (before === false) {
      this.logger.warn(
        `panicRecover: killSwitch already false (operator=${dto.operatorId}); no-op`,
      );
      await this.audit.appendEntry(this.auditPayload(dto, 'PANIC_RECOVER_NOOP', false));
      return {
        action: 'PANIC_RECOVER',
        killSwitchBefore: false,
        killSwitchAfter: false,
        alreadyHalted: false,
        followUpCli: null,
      };
    }

    await this.setKillSwitch(false, dto.operatorId, dto.reason);
    await this.audit.appendEntry(
      this.auditPayload(dto, 'PANIC_RECOVER_CONFIRMED', false, dto.reason),
    );
    this.logger.warn(
      `panicRecover: dex.limits.killSwitch set to false (operator=${dto.operatorId})`,
    );
    return {
      action: 'PANIC_RECOVER',
      killSwitchBefore: before ?? null,
      killSwitchAfter: false,
      alreadyHalted: false,
      followUpCli: null,
    };
  }

  // ----- internals -----------------------------------------------------------

  private async readKillSwitch(): Promise<boolean | null> {
    try {
      const effective = await this.configurations.getEffective(
        'dex.limits',
        undefined,
        undefined,
      );
      const raw = (effective as { configValue?: unknown }).configValue;
      if (typeof raw !== 'string') return null;
      const parsed = JSON.parse(raw) as { killSwitch?: unknown };
      return typeof parsed.killSwitch === 'boolean' ? parsed.killSwitch : null;
    } catch (err) {
      this.logger.warn(
        `readKillSwitch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Flip killSwitch in the existing dex.limits JSON. Reads the current effective
   * value, mutates only the `killSwitch` field (preserving all other limits), and
   * writes a new versioned row via the single-writer ConfigurationsService.update.
   */
  private async setKillSwitch(
    value: boolean,
    operatorId: string,
    reason?: string,
  ): Promise<void> {
    const current = await this.configurations.getByKey(
      'dex.limits',
      ConfigScopeType.GLOBAL,
      undefined,
    );
    if (current === null) {
      throw new BadRequestException(
        'dex.limits configuration not found — seed migration 035 before using panic-button',
      );
    }
    const currentValue = (current as { configValue?: unknown }).configValue;
    const parsed =
      typeof currentValue === 'string'
        ? (JSON.parse(currentValue) as Record<string, unknown>)
        : {};
    parsed.killSwitch = value;
    await this.configurations.update(
      'dex.limits',
      {
        configValue: JSON.stringify(parsed),
        scopeType: ConfigScopeType.GLOBAL,
        isSensitive: true,
        approveReason:
          reason ?? `panic-button ${value ? 'STOP' : 'RECOVER'} (D4-C-3-PANIC)`,
      },
      operatorId,
    );
  }

  private auditPayload(
    dto: PanicActionDto,
    action: string,
    killSwitchAfter: boolean,
    reason?: string,
  ): AuditRecordInput {
    return {
      actor: dto.operatorId,
      action,
      resourceType: 'system',
      resourceId: 'panic-button',
      payload: { killSwitchAfter, reason: reason ?? null, source: 'ui' },
    };
  }

  private followUpCliInstruction(): string {
    return (
      'Live capital path is now halted via dex.limits.killSwitch. ' +
      'To also halt paper-discovery and risk-policy-jobs (env-read flags), ' +
      'run from a terminal: npm run panic:stop'
    );
  }
}

export interface PanicResult {
  action: 'PANIC_STOP' | 'PANIC_RECOVER';
  killSwitchBefore: boolean | null;
  killSwitchAfter: boolean;
  alreadyHalted: boolean;
  /** Instruction for the operator when the UI flow does not cover the full panic. */
  followUpCli: string | null;
}
