 
import type { PanicActionDto, PanicRecoverDto } from './panic.dto';
import { PanicController } from './panic.controller';
import type { PanicService } from './panic.service';

/**
 * PanicController spec — thin adapter over PanicService.
 *
 * Pattern: direct instantiation with a stub service. Only exercises that
 * the controller delegates the DTO verbatim and returns the service result.
 */
describe('PanicController', () => {
  let panic: { panicStop: jest.Mock; panicRecover: jest.Mock };
  let controller: PanicController;

  beforeEach(() => {
    panic = {
      panicStop: jest.fn().mockResolvedValue({ ok: true }),
      panicRecover: jest.fn().mockResolvedValue({ ok: true }),
    };
    controller = new PanicController(panic as unknown as PanicService);
  });

  describe('panicStop', () => {
    it('delegates dto to PanicService.panicStop', async () => {
      const dto: PanicActionDto = {
        operatorId: 'op-1',
        reason: 'capital loss',
      };
      const result = await controller.panicStop(dto);
      expect(panic.panicStop).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ ok: true });
    });

    it('forwards minimal dto (operatorId only)', async () => {
      const dto: PanicActionDto = { operatorId: 'op-2' };
      await controller.panicStop(dto);
      expect(panic.panicStop).toHaveBeenCalledWith(dto);
    });

    it('returns whatever PanicService returns (object shape passes through)', async () => {
      panic.panicStop.mockResolvedValueOnce({
        killSwitch: true,
        action: 'PANIC_STOP_TRIGGERED',
      });
      const result = await controller.panicStop({
        operatorId: 'op-3',
      });
      expect(result).toEqual({
        killSwitch: true,
        action: 'PANIC_STOP_TRIGGERED',
      });
    });
  });

  describe('panicRecover', () => {
    it('delegates dto to PanicService.panicRecover', async () => {
      const dto: PanicRecoverDto = {
        operatorId: 'op-1',
        confirm: 'I UNDERSTAND THIS RESUMES TRADING',
      };
      const result = await controller.panicRecover(dto);
      expect(panic.panicRecover).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ ok: true });
    });

    it('forwards dto with optional reason', async () => {
      const dto: PanicRecoverDto = {
        operatorId: 'op-2',
        confirm: 'I UNDERSTAND THIS RESUMES TRADING',
        reason: 'operator approved resume',
      };
      await controller.panicRecover(dto);
      expect(panic.panicRecover).toHaveBeenCalledWith(dto);
    });
  });
});
