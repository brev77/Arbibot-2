import { BadRequestException } from '@nestjs/common';
import type { AuditRecordInput, IAuditClient } from '@arbibot/nest-platform';
import { AuditClientService } from '@arbibot/nest-platform';

import { ConfigurationsService } from './configurations.service';
import {
  PANIC_RECOVER_CONFIRM_PHRASE,
  type PanicActionDto,
  type PanicRecoverDto,
} from './panic.dto';
import { PanicService } from './panic.service';
import { ConfigScopeType } from '../dto/create-configuration.dto';

/**
 * PanicService spec (D4-C-3-PANIC, risk tracker H3).
 *
 * Pattern: direct instantiation with lightweight mocks for the two collaborators
 * (ConfigurationsService single-writer + IAuditClient append-only), mirroring
 * configurations.service.spec.ts. The service's only logic is the kill-switch
 * read/parse/flip state machine and the typed-confirmation gate on recover —
 * both are pure functions of the mocks, no DB/Redis needed.
 */
describe('PanicService', () => {
  let service: PanicService;
  let configurations: {
    getEffective: jest.Mock;
    getByKey: jest.Mock;
    update: jest.Mock;
  };
  let appendEntry: jest.Mock;
  let audit: IAuditClient;

  const operatorDto = (over: Partial<PanicActionDto> = {}): PanicActionDto => ({
    operatorId: 'op-1',
    ...over,
  });

  const recoverDto = (
    over: Partial<PanicRecoverDto> = {},
  ): PanicRecoverDto => ({
    operatorId: 'op-1',
    confirm: PANIC_RECOVER_CONFIRM_PHRASE,
    ...over,
  });

  /** Build a dex.limits effective row with the given killSwitch value. */
  const limitsRow = (killSwitch: boolean): { configValue: string } => ({
    configValue: JSON.stringify({
      killSwitch,
      maxSlippageBps: 50,
      dailyVolumeCapUsd: 1000,
    }),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    configurations = {
      // Default: getByKey returns a valid dex.limits row; individual tests that
      // need the "missing config" path override this to null.
      getEffective: jest.fn(),
      getByKey: jest.fn().mockResolvedValue(limitsRow(false)),
      update: jest.fn().mockResolvedValue(undefined),
    };
    appendEntry = jest.fn().mockResolvedValue(undefined);
    audit = { appendEntry } as unknown as IAuditClient;
    service = new PanicService(
      configurations as unknown as ConfigurationsService,
      // Cast required by TS (partial mock {appendEntry} -> concrete
      // AuditClientService class), but ESLint's type-info disagrees; suppress
      // the false positive (same ts-jest/typescript-eslint desync as
      // market.service.spec.ts).
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      audit as unknown as AuditClientService,
    );
  });

  describe('panicStop', () => {
    it('flips killSwitch false -> true and audits PANIC_STOP_TRIGGERED', async () => {
      configurations.getEffective.mockResolvedValue(limitsRow(false));

      const result = await service.panicStop(operatorDto({ reason: 'incident' }));

      expect(result).toEqual({
        action: 'PANIC_STOP',
        killSwitchBefore: false,
        killSwitchAfter: true,
        alreadyHalted: false,
        followUpCli: expect.any(String),
      });
      expect(result.followUpCli).toContain('npm run panic:stop');

      // setKillSwitch preserves sibling keys, flips only killSwitch
      expect(configurations.getByKey).toHaveBeenCalledWith(
        'dex.limits',
        ConfigScopeType.GLOBAL,
        undefined,
      );
      expect(configurations.update).toHaveBeenCalledWith(
        'dex.limits',
        expect.objectContaining({
          configValue: JSON.stringify({
            killSwitch: true,
            maxSlippageBps: 50,
            dailyVolumeCapUsd: 1000,
          }),
          scopeType: ConfigScopeType.GLOBAL,
          isSensitive: true,
        }),
        'op-1',
      );

      expect(appendEntry).toHaveBeenCalledTimes(1);
      const payload = appendEntry.mock.calls[0]![0] as AuditRecordInput;
      expect(payload).toMatchObject({
        actor: 'op-1',
        action: 'PANIC_STOP_TRIGGERED',
        resourceType: 'system',
        resourceId: 'panic-button',
      });
      expect(payload.payload).toEqual({
        killSwitchAfter: true,
        reason: 'incident',
        source: 'ui',
      });
    });

    it('is a no-op (alreadyHalted) when killSwitch already true', async () => {
      configurations.getEffective.mockResolvedValue(limitsRow(true));

      const result = await service.panicStop(operatorDto());

      expect(result).toEqual({
        action: 'PANIC_STOP',
        killSwitchBefore: true,
        killSwitchAfter: true,
        alreadyHalted: true,
        followUpCli: expect.any(String),
      });
      // Already halted: do NOT write a new config version, only audit the no-op.
      expect(configurations.getByKey).not.toHaveBeenCalled();
      expect(configurations.update).not.toHaveBeenCalled();
      expect(appendEntry).toHaveBeenCalledTimes(1);
      const payload = appendEntry.mock.calls[0]![0] as AuditRecordInput;
      expect(payload.action).toBe('PANIC_STOP_NOOP');
      expect(payload.payload?.killSwitchAfter).toBe(true);
    });

    it('throws BadRequest when dex.limits config row is missing (seed migration 035)', async () => {
      configurations.getEffective.mockResolvedValue(limitsRow(false));
      configurations.getByKey.mockResolvedValue(null);

      await expect(service.panicStop(operatorDto())).rejects.toThrow(
        BadRequestException,
      );
      expect(configurations.update).not.toHaveBeenCalled();
    });

    it('defaults approveReason to "panic-button STOP" when dto.reason omitted', async () => {
      configurations.getEffective.mockResolvedValue(limitsRow(false));

      await service.panicStop(operatorDto());

      const updateArg = configurations.update.mock.calls[0]![1];
      expect(updateArg.approveReason).toBe(
        'panic-button STOP (D4-C-3-PANIC)',
      );
    });

    it('treats unreadable killSwitch (non-boolean) as null -> proceeds to halt', async () => {
      // configValue present but killSwitch field missing -> readKillSwitch returns null
      configurations.getEffective.mockResolvedValue({
        configValue: JSON.stringify({ maxSlippageBps: 50 }),
      });

      const result = await service.panicStop(operatorDto());

      expect(result.killSwitchBefore).toBeNull();
      expect(result.alreadyHalted).toBe(false);
      expect(configurations.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('panicRecover', () => {
    it('flips killSwitch true -> false and audits PANIC_RECOVER_CONFIRMED', async () => {
      configurations.getEffective.mockResolvedValue(limitsRow(true));
      configurations.getByKey.mockResolvedValue(limitsRow(true));

      const result = await service.panicRecover(
        recoverDto({ reason: 'all-clear' }),
      );

      expect(result).toEqual({
        action: 'PANIC_RECOVER',
        killSwitchBefore: true,
        killSwitchAfter: false,
        alreadyHalted: false,
        followUpCli: null,
      });
      // Recover: no CLI follow-up (the UI flow is the complete recover path).
      expect(result.followUpCli).toBeNull();

      expect(configurations.update).toHaveBeenCalledWith(
        'dex.limits',
        expect.objectContaining({
          configValue: JSON.stringify({
            killSwitch: false,
            maxSlippageBps: 50,
            dailyVolumeCapUsd: 1000,
          }),
          approveReason: 'all-clear',
        }),
        'op-1',
      );
      const payload = appendEntry.mock.calls[0]![0] as AuditRecordInput;
      expect(payload.action).toBe('PANIC_RECOVER_CONFIRMED');
      expect(payload.payload?.killSwitchAfter).toBe(false);
    });

    it('rejects recovery when confirmation phrase is wrong (never single-click)', async () => {
      configurations.getEffective.mockResolvedValue(limitsRow(true));

      await expect(
        service.panicRecover(recoverDto({ confirm: 'yes' })),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.panicRecover(recoverDto({ confirm: 'yes' })),
      ).rejects.toThrow(new RegExp(PANIC_RECOVER_CONFIRM_PHRASE));

      // Must not touch config or audit on a rejected recover.
      expect(configurations.getByKey).not.toHaveBeenCalled();
      expect(configurations.update).not.toHaveBeenCalled();
      expect(appendEntry).not.toHaveBeenCalled();
    });

    it('is a no-op when killSwitch already false', async () => {
      configurations.getEffective.mockResolvedValue(limitsRow(false));

      const result = await service.panicRecover(recoverDto());

      expect(result).toEqual({
        action: 'PANIC_RECOVER',
        killSwitchBefore: false,
        killSwitchAfter: false,
        alreadyHalted: false,
        followUpCli: null,
      });
      expect(configurations.update).not.toHaveBeenCalled();
      expect(appendEntry).toHaveBeenCalledTimes(1);
      const payload = appendEntry.mock.calls[0]![0] as AuditRecordInput;
      expect(payload.action).toBe('PANIC_RECOVER_NOOP');
    });

    it('defaults approveReason to "panic-button RECOVER" when reason omitted', async () => {
      configurations.getEffective.mockResolvedValue(limitsRow(true));
      configurations.getByKey.mockResolvedValue(limitsRow(true));

      await service.panicRecover(recoverDto());

      const updateArg = configurations.update.mock.calls[0]![1];
      expect(updateArg.approveReason).toBe(
        'panic-button RECOVER (D4-C-3-PANIC)',
      );
    });
  });

  describe('readKillSwitch resilience', () => {
    it('returns null (-> proceeds) when getEffective throws', async () => {
      configurations.getEffective.mockRejectedValue(new Error('redis down'));
      configurations.getByKey.mockResolvedValue(limitsRow(false));

      const result = await service.panicStop(operatorDto());

      // read failed -> null, treated as "not halted" -> stop proceeds
      expect(result.killSwitchBefore).toBeNull();
      expect(result.alreadyHalted).toBe(false);
      expect(configurations.update).toHaveBeenCalledTimes(1);
    });

    it('returns null when configValue is not a string', async () => {
      configurations.getEffective.mockResolvedValue({ configValue: 42 });

      const result = await service.panicStop(operatorDto());

      // readKillSwitch returns null (non-string configValue) -> treated as
      // "not halted" -> panicStop proceeds to flip via setKillSwitch.
      expect(result.killSwitchBefore).toBeNull();
      expect(result.alreadyHalted).toBe(false);
      expect(configurations.update).toHaveBeenCalledTimes(1);
    });

    it('handles non-Error throws in readKillSwitch (logs String(err), returns null)', async () => {
      // A non-Error rejection exercises the `err instanceof Error` false branch.
      configurations.getEffective.mockRejectedValue('string-thrown');
      configurations.getByKey.mockResolvedValue(limitsRow(false));

      const result = await service.panicStop(operatorDto());

      expect(result.killSwitchBefore).toBeNull();
      expect(configurations.update).toHaveBeenCalledTimes(1);
    });

    it('panicRecover proceeds (before=null) when killSwitch unreadable', async () => {
      configurations.getEffective.mockResolvedValue({ configValue: 42 });
      configurations.getByKey.mockResolvedValue(limitsRow(true));

      const result = await service.panicRecover(recoverDto());

      // before=null (unreadable) -> not "already false" -> recover proceeds.
      expect(result.killSwitchBefore).toBeNull();
      expect(result.killSwitchAfter).toBe(false);
      expect(configurations.update).toHaveBeenCalledTimes(1);
    });

    it('setKillSwitch defaults to {} when getByKey configValue is not a string', async () => {
      configurations.getEffective.mockResolvedValue(limitsRow(false));
      // getByKey returns a row whose configValue is non-string -> parsed = {} ->
      // only killSwitch is set in the written value.
      configurations.getByKey.mockResolvedValue({ configValue: 42 });

      await service.panicStop(operatorDto());

      const written = configurations.update.mock.calls[0]![1];
      expect(written.configValue).toBe(JSON.stringify({ killSwitch: true }));
    });
  });
});
