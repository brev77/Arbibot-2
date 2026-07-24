import { ScannerFindingEntity } from '@arbibot/persistence';
import { signedFetch } from '@arbibot/nest-platform';

import { ScannerPublisherService } from './scanner-publisher.service';
import type { CrossVenueSpread } from './scanner-spread.service';

jest.mock('@arbibot/nest-platform', () => {
  const actual = jest.requireActual('@arbibot/nest-platform');
  return { ...actual, signedFetch: jest.fn() };
});

const signedFetchMock = signedFetch as unknown as jest.Mock;

const makeFinding = (overrides: Partial<ScannerFindingEntity> = {}): ScannerFindingEntity =>
  ({
    id: 'f-1',
    instanceId: 'arb-2venue-1',
    opportunityId: null,
    publishStatus: 'pending',
    publishAttempts: 0,
    canonicalToken: '0xUSDC',
    chainId: 42161,
    buyVenue: 'uniswap-v2',
    sellVenue: 'sushiswap',
    buyPoolAddr: '0xBUY',
    sellPoolAddr: '0xSELL',
    spreadBps: 50,
    grossProfitUsd: '5.000000',
    netProfitUsd: '4.000000',
    feesUsd: '6.000000',
    volume1hUsd: '100000.00000000',
    volume24hUsd: null,
    observedAt: new Date(),
    ...overrides,
  });

const makeSpread = (overrides: Partial<CrossVenueSpread> = {}): CrossVenueSpread => ({
  chainId: 42161,
  canonicalToken: '0xUSDC',
  token0: '0xWETH',
  token1: '0xUSDC',
  buyVenue: 'uniswap-v2',
  buyPoolAddress: '0xBUY',
  buyPrice: 2000,
  sellVenue: 'sushiswap',
  sellPoolAddress: '0xSELL',
  sellPrice: 2010,
  spreadBps: 50,
  feesUsd: 6,
  gasUsd: 0,
  grossProfitUsd: 5,
  netProfitUsd: 4,
  ...overrides,
});

describe('ScannerPublisherService', () => {
  const originalEnv = process.env;
  let findingsRepo: { findOne: jest.Mock; save: jest.Mock };
  let service: ScannerPublisherService;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.OPPORTUNITY_SERVICE_URL = 'http://127.0.0.1:3010';
    signedFetchMock.mockReset();
    findingsRepo = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((x: ScannerFindingEntity) => Promise.resolve(x)),
    };
    service = new ScannerPublisherService(findingsRepo as never);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('publish — success', () => {
    it('POSTs to /opportunities and saves opportunityId + published', async () => {
      signedFetchMock.mockResolvedValue({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ id: 'opp-1', state: 'detected' }),
      });
      const finding = makeFinding();

      const result = await service.publish(finding, makeSpread(), 5000);

      expect(result).toBe('opp-1');
      expect(finding.publishStatus).toBe('published');
      expect(finding.opportunityId).toBe('opp-1');
      expect(finding.publishAttempts).toBe(1);
      expect(findingsRepo.save).toHaveBeenCalled();
    });

    it('sends payload with sourceModule=scanner-service', async () => {
      signedFetchMock.mockResolvedValue({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ id: 'opp-1' }),
      });
      await service.publish(makeFinding(), makeSpread(), 5000);

      const call = signedFetchMock.mock.calls[0];
      const body = JSON.parse(call[1].body as string);
      expect(body.payload.sourceModule).toBe('scanner-service');
      expect(body.payload.spreadBps).toBe(50);
      expect(body.payload.chainId).toBe(42161);
      expect(body.payload.buyVenue).toBe('uniswap-v2');
      expect(body.payload.sellVenue).toBe('sushiswap');
      expect(body.payload.volumeUsd).toBe(100000);
      expect(body.payload.evidence.buyPoolAddress).toBe('0xBUY');
    });
  });

  describe('publish — failure', () => {
    it('marks failed on non-ok HTTP', async () => {
      signedFetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });
      const finding = makeFinding();

      const result = await service.publish(finding, makeSpread(), 5000);

      expect(result).toBeNull();
      expect(finding.publishStatus).toBe('failed');
      expect(finding.publishAttempts).toBe(1);
    });

    it('marks failed on missing id in response', async () => {
      signedFetchMock.mockResolvedValue({
        ok: true,
        status: 201,
        json: () => Promise.resolve({}),
      });
      const finding = makeFinding();
      const result = await service.publish(finding, makeSpread(), 5000);
      expect(result).toBeNull();
      expect(finding.publishStatus).toBe('failed');
    });

    it('marks failed on network error', async () => {
      signedFetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      const finding = makeFinding();
      const result = await service.publish(finding, makeSpread(), 5000);
      expect(result).toBeNull();
      expect(finding.publishStatus).toBe('failed');
    });
  });

  describe('publish — OPPORTUNITY_SERVICE_URL unset', () => {
    it('marks failed without making a request', async () => {
      delete process.env.OPPORTUNITY_SERVICE_URL;
      const finding = makeFinding();
      const result = await service.publish(finding, makeSpread(), 5000);
      expect(result).toBeNull();
      expect(finding.publishStatus).toBe('failed');
      expect(signedFetchMock).not.toHaveBeenCalled();
    });
  });

  describe('republishById', () => {
    it('loads finding then publishes', async () => {
      const finding = makeFinding({ id: 'f-2', publishStatus: 'failed' });
      findingsRepo.findOne.mockResolvedValue(finding);
      signedFetchMock.mockResolvedValue({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ id: 'opp-2' }),
      });

      const result = await service.republishById('f-2', makeSpread(), 5000);

      expect(findingsRepo.findOne).toHaveBeenCalledWith({ where: { id: 'f-2' } });
      expect(result).toBe('opp-2');
      expect(finding.publishStatus).toBe('published');
    });

    it('returns null when finding not found', async () => {
      findingsRepo.findOne.mockResolvedValue(null);
      const result = await service.republishById('missing', makeSpread(), 5000);
      expect(result).toBeNull();
    });
  });
});
