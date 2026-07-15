import { Test } from '@nestjs/testing';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { BridgeTransferEntity } from '@arbibot/persistence';

import { BridgeTransferPollingWorker } from './bridge-transfer-polling.worker';
import { BridgeTransferService } from '../bridge/bridge-transfer.service';
import { BridgeAdapterFactoryService } from '../bridge/bridge-adapter-factory.service';

// ───────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────

describe('BridgeTransferPollingWorker', () => {
  let worker: BridgeTransferPollingWorker;

  let bridgeTransferServiceMock: Partial<BridgeTransferService>;
  let bridgeAdapterFactoryMock: Partial<BridgeAdapterFactoryService>;

  beforeEach(async () => {
    getArbibotMetricsRegistry().clear();
    delete process.env.BRIDGE_POLLING_ENABLED;

    bridgeTransferServiceMock = {
      getActiveTransfers: jest.fn(),
      markTimedOut: jest.fn(),
      pollAndUpdateStatus: jest.fn(),
    };
    bridgeAdapterFactoryMock = {
      resolveAdapter: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        BridgeTransferPollingWorker,
        { provide: BridgeTransferService, useValue: bridgeTransferServiceMock },
        { provide: BridgeAdapterFactoryService, useValue: bridgeAdapterFactoryMock },
      ],
    }).compile();

    worker = module.get(BridgeTransferPollingWorker);
  });

  afterEach(() => {
    worker.onModuleDestroy();
  });

  it('should short-circuit when no active transfers', async () => {
    (bridgeTransferServiceMock.getActiveTransfers as jest.Mock).mockResolvedValueOnce([]);

    const result = await worker.pollOnce();

    expect(result).toEqual({ polled: 0, timedOut: 0, completed: 0 });
    expect(bridgeTransferServiceMock.markTimedOut).not.toHaveBeenCalled();
  });

  it('should mark transfer timed_out when timeout_at exceeded', async () => {
    const expiredTransfer = {
      id: 't-expired',
      bridgeKey: 'across',
      sourceChainId: 42161,
      destinationChainId: 8453,
      status: 'pending',
      timeoutAt: new Date(Date.now() - 60_000), // expired 1 min ago
    } as BridgeTransferEntity;

    (bridgeTransferServiceMock.getActiveTransfers as jest.Mock).mockResolvedValueOnce([
      expiredTransfer,
    ]);

    const result = await worker.pollOnce();

    expect(bridgeTransferServiceMock.markTimedOut).toHaveBeenCalledWith('t-expired');
    expect(result.timedOut).toBe(1);
    expect(result.polled).toBe(1);
    // Should NOT poll status for expired transfers.
    expect(bridgeTransferServiceMock.pollAndUpdateStatus).not.toHaveBeenCalled();
  });

  it('should skip transfer when adapter cannot be resolved', async () => {
    const transfer = {
      id: 't-no-adapter',
      bridgeKey: 'unknown-bridge',
      sourceChainId: 42161,
      destinationChainId: 8453,
      status: 'pending',
      timeoutAt: new Date(Date.now() + 600_000), // not expired
    } as BridgeTransferEntity;

    (bridgeTransferServiceMock.getActiveTransfers as jest.Mock).mockResolvedValueOnce([transfer]);
    (bridgeAdapterFactoryMock.resolveAdapter as jest.Mock).mockImplementation(() => {
      throw new Error('unknown bridgeKey');
    });

    const result = await worker.pollOnce();

    expect(result.polled).toBe(1);
    expect(result.completed).toBe(0);
    expect(bridgeTransferServiceMock.pollAndUpdateStatus).not.toHaveBeenCalled();
  });

  it('should poll status and count completed transitions', async () => {
    const transfer = {
      id: 't-active',
      bridgeKey: 'across',
      sourceChainId: 42161,
      destinationChainId: 8453,
      status: 'relaying',
      timeoutAt: new Date(Date.now() + 600_000),
    } as BridgeTransferEntity;

    const fakeAdapter = { bridgeKey: 'across' };
    const updatedEntity = { ...transfer, status: 'completed' };

    (bridgeTransferServiceMock.getActiveTransfers as jest.Mock).mockResolvedValueOnce([transfer]);
    (bridgeAdapterFactoryMock.resolveAdapter as jest.Mock).mockReturnValueOnce(fakeAdapter);
    (bridgeTransferServiceMock.pollAndUpdateStatus as jest.Mock).mockResolvedValueOnce(updatedEntity);

    const result = await worker.pollOnce();

    expect(bridgeTransferServiceMock.pollAndUpdateStatus).toHaveBeenCalledWith(
      transfer,
      fakeAdapter,
    );
    expect(result.completed).toBe(1);
    expect(result.polled).toBe(1);
  });

  it('should isolate per-transfer errors (one failure does not abort the cycle)', async () => {
    const goodTransfer = {
      id: 't-good',
      bridgeKey: 'across',
      sourceChainId: 42161,
      destinationChainId: 8453,
      status: 'pending',
      timeoutAt: new Date(Date.now() + 600_000),
    } as BridgeTransferEntity;

    const badTransfer = {
      id: 't-bad',
      bridgeKey: 'across',
      sourceChainId: 42161,
      destinationChainId: 8453,
      status: 'pending',
      timeoutAt: new Date(Date.now() + 600_000),
    } as BridgeTransferEntity;

    const fakeAdapter = { bridgeKey: 'across' };

    (bridgeTransferServiceMock.getActiveTransfers as jest.Mock).mockResolvedValueOnce([
      badTransfer,
      goodTransfer,
    ]);
    (bridgeAdapterFactoryMock.resolveAdapter as jest.Mock).mockReturnValue(fakeAdapter);
    // First poll throws, second succeeds.
    (bridgeTransferServiceMock.pollAndUpdateStatus as jest.Mock)
      .mockRejectedValueOnce(new Error('transient RPC error'))
      .mockResolvedValueOnce({ ...goodTransfer, status: 'relaying' });

    const result = await worker.pollOnce();

    expect(result.polled).toBe(2);
    // The cycle did not abort — both transfers were polled.
    expect(bridgeTransferServiceMock.pollAndUpdateStatus).toHaveBeenCalledTimes(2);
  });
});
